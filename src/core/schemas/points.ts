import type {
  AlembicWasmModule,
  IObjectWrap,
  IPointsWrap,
  OPointsWrap,
} from "../../wasm/bindings.js";
import { readBigUint64View, readFloat32View } from "../../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { IGeomParam } from "../geomParam.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import { GeometryScope, fromBox3dDesc, type Box3d } from "../types.js";
import { IObject, OObject } from "../object.js";

export interface PointsSample {
  positions: Float32Array;
  ids: BigUint64Array;
  velocities: Float32Array | null;
  selfBounds: Box3d | null;
}

export interface PointsSampleInput {
  positions: Float32Array | readonly number[];
  ids?: BigUint64Array | readonly bigint[] | readonly number[];
  velocities?: Float32Array | readonly number[];
  widths?: Float32Array | readonly number[];
  widthScope?: GeometryScope;
}

export class IPoints implements Disposable {
  readonly kind = "Points" as const;
  readonly object: IObject;
  readonly handle: IPointsWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.IPointsWrap(this.object.handle));
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

  get timeSamplingIndex(): number {
    return callWasm(this.mod, () => this.handle.getTimeSamplingIndex());
  }

  getSample(selector?: SampleSelectorInput, copy = true): PointsSample {
    const { mode, value } = resolveSampleSelector(selector);
    const raw = callWasm(this.mod, () => this.handle.getRawSample(mode, value));
    return {
      positions: readFloat32View(this.mod, raw.positions, copy),
      ids: readBigUint64View(this.mod, raw.ids, copy),
      velocities: raw.velocities.length > 0 ? readFloat32View(this.mod, raw.velocities, copy) : null,
      selfBounds: fromBox3dDesc(raw.selfBounds),
    };
  }

  getWidthsParam(): IGeomParam | null {
    const raw = callWasm(this.mod, () => this.handle.getWidthsParam());
    return raw ? new IGeomParam(raw, this.mod) : null;
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

export interface CreateOPointsOptions {
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class OPoints implements Disposable {
  readonly handle: OPointsWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateOPointsOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOPoints(
        parent.handle,
        name,
        options?.timeSamplingIndex ?? 0,
        normalizeMetaData(options?.metaData)
      )
    );
  }

  get object(): OObject {
    return new OObject(callWasm(this.mod, () => this.handle.getObject()), this.mod);
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  setSample(sample: PointsSampleInput): void {
    const pos =
      sample.positions instanceof Float32Array
        ? sample.positions
        : Float32Array.from(sample.positions);
    const ids = sample.ids
      ? sample.ids instanceof BigUint64Array
        ? sample.ids
        : BigUint64Array.from(Array.from(sample.ids as Iterable<number | bigint>, (v) => BigInt(v)))
      : null;
    const vel = sample.velocities
      ? sample.velocities instanceof Float32Array
        ? sample.velocities
        : Float32Array.from(sample.velocities)
      : null;
    const widths = sample.widths
      ? sample.widths instanceof Float32Array
        ? sample.widths
        : Float32Array.from(sample.widths)
      : null;

    const ptrs = getAlembicArena().stageViews([pos, ids, vel, widths]);
    callWasm(this.mod, () =>
      this.handle.setSample(
        ptrs[0]!,
        Math.floor(pos.length / 3),
        ptrs[1]!,
        ids ? ids.length : 0,
        ptrs[2]!,
        vel ? Math.floor(vel.length / 3) : 0,
        ptrs[3]!,
        widths ? widths.length : 0,
        sample.widthScope ?? GeometryScope.Vertex
      )
    );
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
