import type {
  AlembicWasmModule,
  IFaceSetWrap,
  IObjectWrap,
  OFaceSetWrap,
} from "../../wasm/bindings.js";
import { readInt32View } from "../../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import { FaceSetExclusivity, fromBox3dDesc, type Box3d } from "../types.js";
import { IObject, OObject } from "../object.js";

export class IFaceSet implements Disposable {
  readonly kind = "FaceSet" as const;
  readonly handle: IFaceSetWrap;
  private readonly mod: AlembicWasmModule;

  constructor(objectOrWrap: IObject | IObjectWrap | IFaceSetWrap, mod = getAlembicModule()) {
    this.mod = mod;
    if (objectOrWrap instanceof IObject) {
      this.handle = callWasm(mod, () => new mod.IFaceSetWrap(objectOrWrap.handle));
    } else if ("getSchemaType" in objectOrWrap) {
      this.handle = callWasm(mod, () => new mod.IFaceSetWrap(objectOrWrap));
    } else {
      this.handle = objectOrWrap;
    }
  }

  get object(): IObject {
    return new IObject(callWasm(this.mod, () => this.handle.getObject()), this.mod);
  }

  get valid(): boolean {
    return callWasm(this.mod, () => this.handle.valid());
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get fullName(): string {
    return callWasm(this.mod, () => this.handle.getFullName());
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  get isConstant(): boolean {
    return callWasm(this.mod, () => this.handle.isConstant());
  }

  get exclusivity(): FaceSetExclusivity {
    return callWasm(this.mod, () => this.handle.getFaceExclusivity() as FaceSetExclusivity);
  }

  get timeSamplingIndex(): number {
    return callWasm(this.mod, () => this.handle.getTimeSamplingIndex());
  }

  getFaces(selector?: SampleSelectorInput, copy = true): Int32Array {
    const { mode, value } = resolveSampleSelector(selector);
    const desc = callWasm(this.mod, () => this.handle.getFaces(mode, value));
    return readInt32View(this.mod, desc, copy);
  }

  getSelfBounds(selector?: SampleSelectorInput): Box3d | null {
    const { mode, value } = resolveSampleSelector(selector);
    return fromBox3dDesc(callWasm(this.mod, () => this.handle.getSelfBounds(mode, value)));
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

export interface CreateOFaceSetOptions {
  timeSamplingIndex?: number;
  exclusivity?: FaceSetExclusivity;
  metaData?: MetaDataMap;
}

export class OFaceSet implements Disposable {
  readonly handle: OFaceSetWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parentOrWrap: OObject | OFaceSetWrap,
    name?: string,
    options?: CreateOFaceSetOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    if (parentOrWrap instanceof OObject) {
      this.handle = callWasm(mod, () =>
        mod.createOFaceSet(
          parentOrWrap.handle,
          name ?? "faceset",
          options?.timeSamplingIndex ?? 0,
          normalizeMetaData(options?.metaData)
        )
      );
      if (options?.exclusivity !== undefined) {
        this.setExclusivity(options.exclusivity);
      }
    } else {
      this.handle = parentOrWrap;
    }
  }

  get object(): OObject {
    return new OObject(callWasm(this.mod, () => this.handle.getObject()), this.mod);
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  get exclusivity(): FaceSetExclusivity {
    return callWasm(this.mod, () => this.handle.getFaceExclusivity() as FaceSetExclusivity);
  }

  setExclusivity(exclusivity: FaceSetExclusivity): void {
    callWasm(this.mod, () => this.handle.setFaceExclusivity(exclusivity));
  }

  setFaces(faceIndices: Int32Array | readonly number[]): void {
    const i32 = faceIndices instanceof Int32Array ? faceIndices : Int32Array.from(faceIndices);
    const ptr = getAlembicArena().stageSingle(i32);
    callWasm(this.mod, () => this.handle.setFaces(ptr, i32.length));
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
