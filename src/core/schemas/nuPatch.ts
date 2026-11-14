import type {
  AlembicWasmModule,
  INuPatchWrap,
  IObjectWrap,
  ONuPatchWrap,
} from "../../wasm/bindings.js";
import { readFloat32View } from "../../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { IGeomParam } from "../geomParam.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import { TopologyVariance, fromBox3dDesc, type Box3d } from "../types.js";
import { IObject, OObject } from "../object.js";
import { extractRenderMeshData, type RenderMeshData } from "./polyMesh.js";

export interface NuPatchSample {
  positions: Float32Array;
  velocities: Float32Array | null;
  positionWeights: Float32Array | null;
  numU: number;
  numV: number;
  uOrder: number;
  vOrder: number;
  uKnot: Float32Array;
  vKnot: Float32Array;
  hasTrimCurve: boolean;
  selfBounds: Box3d | null;
}

export interface NuPatchSampleInput {
  positions: Float32Array | readonly number[];
  numU: number;
  numV: number;
  uOrder: number;
  vOrder: number;
  uKnot: Float32Array | readonly number[];
  vKnot: Float32Array | readonly number[];
  positionWeights?: Float32Array | readonly number[];
  velocities?: Float32Array | readonly number[];
}

export class INuPatch implements Disposable {
  readonly kind = "NuPatch" as const;
  readonly object: IObject;
  readonly handle: INuPatchWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.INuPatchWrap(this.object.handle));
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

  get topologyVariance(): TopologyVariance {
    return callWasm(this.mod, () => this.handle.getTopologyVariance() as TopologyVariance);
  }

  get timeSamplingIndex(): number {
    return callWasm(this.mod, () => this.handle.getTimeSamplingIndex());
  }

  getSample(selector?: SampleSelectorInput, copy = true): NuPatchSample {
    const { mode, value } = resolveSampleSelector(selector);
    const raw = callWasm(this.mod, () => this.handle.getRawSample(mode, value));
    return {
      positions: readFloat32View(this.mod, raw.positions, copy),
      velocities: raw.velocities.length > 0 ? readFloat32View(this.mod, raw.velocities, copy) : null,
      positionWeights:
        raw.positionWeights.length > 0 ? readFloat32View(this.mod, raw.positionWeights, copy) : null,
      numU: raw.numU,
      numV: raw.numV,
      uOrder: raw.uOrder,
      vOrder: raw.vOrder,
      uKnot: readFloat32View(this.mod, raw.uKnot, copy),
      vKnot: readFloat32View(this.mod, raw.vKnot, copy),
      hasTrimCurve: raw.hasTrimCurve,
      selfBounds: fromBox3dDesc(raw.selfBounds),
    };
  }

  getUVsParam(): IGeomParam | null {
    const raw = callWasm(this.mod, () => this.handle.getUVsParam());
    return raw ? new IGeomParam(raw, this.mod) : null;
  }

  getNormalsParam(): IGeomParam | null {
    const raw = callWasm(this.mod, () => this.handle.getNormalsParam());
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

  buildRenderMesh(
    selector?: SampleSelectorInput,
    options?: { uSegments?: number; vSegments?: number; reverseWinding?: boolean }
  ): RenderMeshData {
    const { mode, value } = resolveSampleSelector(selector);
    const uSegments = options?.uSegments ?? 16;
    const vSegments = options?.vSegments ?? 16;
    const reverseWinding = options?.reverseWinding ?? true;
    const buf = callWasm(this.mod, () =>
      this.handle.buildRenderBuffer(mode, value, uSegments, vSegments, reverseWinding)
    );
    try {
      return extractRenderMeshData(this.mod, buf, true);
    } finally {
      buf.delete();
    }
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

export interface CreateONuPatchOptions {
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class ONuPatch implements Disposable {
  readonly handle: ONuPatchWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateONuPatchOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createONuPatch(
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

  setSample(sample: NuPatchSampleInput): void {
    const pos =
      sample.positions instanceof Float32Array
        ? sample.positions
        : Float32Array.from(sample.positions);
    const uKnot =
      sample.uKnot instanceof Float32Array ? sample.uKnot : Float32Array.from(sample.uKnot);
    const vKnot =
      sample.vKnot instanceof Float32Array ? sample.vKnot : Float32Array.from(sample.vKnot);
    const weights = sample.positionWeights
      ? sample.positionWeights instanceof Float32Array
        ? sample.positionWeights
        : Float32Array.from(sample.positionWeights)
      : null;
    const vel = sample.velocities
      ? sample.velocities instanceof Float32Array
        ? sample.velocities
        : Float32Array.from(sample.velocities)
      : null;

    const ptrs = getAlembicArena().stageViews([pos, uKnot, vKnot, weights, vel]);
    callWasm(this.mod, () =>
      this.handle.setSample(
        ptrs[0]!,
        Math.floor(pos.length / 3),
        sample.numU,
        sample.numV,
        sample.uOrder,
        sample.vOrder,
        ptrs[1]!,
        uKnot.length,
        ptrs[2]!,
        vKnot.length,
        ptrs[3]!,
        weights ? weights.length : 0,
        ptrs[4]!,
        vel ? Math.floor(vel.length / 3) : 0
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
