import type {
  AlembicWasmModule,
  IObjectWrap,
  IXformWrap,
  OXformWrap,
  RawXformOpDesc,
} from "../../wasm/bindings.js";
import { readFloat64View } from "../../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../../wasm/loader.js";
import { AlembicError, callWasm } from "../errors.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import { XformOperationType, fromBox3dDesc, type Box3d } from "../types.js";
import { IObject, OObject } from "../object.js";

export interface XformOpInput {
  type: XformOperationType;
  hint?: number;
  channels: readonly number[];
}

export type XformOpDesc = RawXformOpDesc;

export class IXform implements Disposable {
  readonly kind = "Xform" as const;
  readonly object: IObject;
  readonly handle: IXformWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.IXformWrap(this.object.handle));
  }

  get valid(): boolean {
    return callWasm(this.mod, () => this.handle.valid());
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  get isConstant(): boolean {
    return callWasm(this.mod, () => this.handle.isConstant());
  }

  get isConstantIdentity(): boolean {
    return callWasm(this.mod, () => this.handle.isConstantIdentity());
  }

  get timeSamplingIndex(): number {
    return callWasm(this.mod, () => this.handle.getTimeSamplingIndex());
  }

  /**
   * Returns the 16-element row-major `M44d` matrix (row-vector convention `v' = v * M`,
   * matching Three.js `Matrix4.fromArray()` column-major storage directly!).
   */
  getMatrix(selector?: SampleSelectorInput, copy = true): Float64Array {
    const { mode, value } = resolveSampleSelector(selector);
    const desc = callWasm(this.mod, () => this.handle.getMatrix(mode, value));
    return readFloat64View(this.mod, desc, copy);
  }

  /**
   * Evaluates a sub-frame interpolated `M44d` matrix at `timeSeconds` (interpolating per-op
   * channels when op stacks match, or falling back to step/matrix lerp).
   */
  getInterpolatedMatrix(timeSeconds: number, copy = true): Float64Array {
    const desc = callWasm(this.mod, () => this.handle.getInterpolatedMatrix(timeSeconds));
    return readFloat64View(this.mod, desc, copy);
  }

  getInheritsXforms(selector?: SampleSelectorInput): boolean {
    const { mode, value } = resolveSampleSelector(selector);
    return callWasm(this.mod, () => this.handle.getInheritsXforms(mode, value));
  }

  getSampleOps(selector?: SampleSelectorInput): XformOpDesc[] {
    const { mode, value } = resolveSampleSelector(selector);
    return callWasm(this.mod, () => this.handle.getSampleOps(mode, value));
  }

  getChildBounds(selector?: SampleSelectorInput): Box3d | null {
    const { mode, value } = resolveSampleSelector(selector);
    return fromBox3dDesc(callWasm(this.mod, () => this.handle.getChildBounds(mode, value)));
  }

  getArbGeomParams(): ICompoundProperty | null {
    const raw = callWasm(this.mod, () => this.handle.getArbGeomParams());
    return raw ? new ICompoundProperty(raw, this.mod) : null;
  }

  getUserProperties(): ICompoundProperty | null {
    const raw = callWasm(this.mod, () => this.handle.getUserProperties());
    return raw ? new ICompoundProperty(raw, this.mod) : null;
  }

  dispose(): void {
    if (!this.handle.isDeleted()) {
      this.handle.delete();
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export interface CreateOXformOptions {
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class OXform implements Disposable {
  readonly handle: OXformWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateOXformOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOXform(
        parent.handle,
        name,
        options?.timeSamplingIndex ?? 0,
        normalizeMetaData(options?.metaData)
      )
    );
  }

  get object(): OObject {
    const raw = callWasm(this.mod, () => this.handle.getObject());
    return new OObject(raw, this.mod);
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  setMatrixSample(matrix16: Float64Array | Float32Array | readonly number[], inherits = true): void {
    if (matrix16.length !== 16) {
      throw new AlembicError(`OXform.setMatrixSample expects 16 numbers, received ${matrix16.length}.`);
    }
    const f64 = matrix16 instanceof Float64Array ? matrix16 : Float64Array.from(matrix16);
    const ptr = getAlembicArena().stageSingle(f64);
    callWasm(this.mod, () => this.handle.setMatrixSample(ptr, inherits));
  }

  setOpsSample(ops: readonly XformOpInput[], inherits = true): void {
    const formatted = ops.map((op) => ({
      type: op.type,
      hint: op.hint ?? 0,
      channels: Array.from(op.channels),
    }));
    callWasm(this.mod, () => this.handle.setOpsSample(formatted, inherits));
  }

  setFromPrevious(): void {
    callWasm(this.mod, () => this.handle.setFromPrevious());
  }

  setTimeSampling(timeSamplingIndex: number): void {
    callWasm(this.mod, () => this.handle.setTimeSampling(timeSamplingIndex));
  }

  getArbGeomParams(): OCompoundProperty {
    return new OCompoundProperty(callWasm(this.mod, () => this.handle.getArbGeomParams()), this.mod);
  }

  getUserProperties(): OCompoundProperty {
    return new OCompoundProperty(callWasm(this.mod, () => this.handle.getUserProperties()), this.mod);
  }

  dispose(): void {
    if (!this.handle.isDeleted()) {
      this.handle.delete();
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
