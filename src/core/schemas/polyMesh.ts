import type {
  AlembicWasmModule,
  HomogeneousMeshPlan,
  IObjectWrap,
  IPolyMeshWrap,
  OPolyMeshWrap,
  RawDrawGroupDesc,
  RenderMeshBuffer,
} from "../../wasm/bindings.js";
import { readFloat32View, readInt32View, readUint32View } from "../../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { IGeomParam } from "../geomParam.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import {
  GeometryScope,
  TopologyVariance,
  fromBox3dDesc,
  toBox3dDesc,
  type Box3d,
} from "../types.js";
import { IObject, OObject } from "../object.js";
import { IFaceSet, OFaceSet } from "./faceSet.js";

export type DrawGroup = RawDrawGroupDesc;

export interface RenderMeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  indices: Uint32Array;
  groups: DrawGroup[];
  bounds: Box3d | null;
  vertexCount: number;
  indexCount: number;
}

export function extractRenderMeshData(
  mod: AlembicWasmModule,
  buf: RenderMeshBuffer,
  copy = true
): RenderMeshData {
  const positions = readFloat32View(mod, buf.getPositionsView(), copy);
  const normals = readFloat32View(mod, buf.getNormalsView(), copy);
  const uvs = buf.hasUVs ? readFloat32View(mod, buf.getUVsView(), copy) : null;
  const colors = buf.hasColors ? readFloat32View(mod, buf.getColorsView(), copy) : null;
  const indices = readUint32View(mod, buf.getIndicesView(), copy);
  const groups = buf.getGroups();
  const bounds = fromBox3dDesc(buf.getBounds());
  return {
    positions,
    normals,
    uvs,
    colors,
    indices,
    groups,
    bounds,
    vertexCount: buf.getVertexCount(),
    indexCount: buf.getIndexCount(),
  };
}

export interface PolyMeshSample {
  positions: Float32Array;
  velocities: Float32Array | null;
  faceIndices: Int32Array;
  faceCounts: Int32Array;
  selfBounds: Box3d | null;
}

export interface PolyMeshSampleInput {
  positions: Float32Array | readonly number[];
  faceIndices?: Int32Array | readonly number[];
  faceCounts?: Int32Array | readonly number[];
  velocities?: Float32Array | readonly number[];
  uvs?: Float32Array | readonly number[];
  uvIndices?: Uint32Array | readonly number[];
  uvScope?: GeometryScope;
  normals?: Float32Array | readonly number[];
  normalIndices?: Uint32Array | readonly number[];
  normalScope?: GeometryScope;
  selfBounds?: Box3d | null;
}

export interface BuildPolyMeshRenderOptions {
  reverseWinding?: boolean;
  flatNormals?: boolean;
  velocityDt?: number;
}

export class HomogeneousMeshEvaluator implements Disposable {
  readonly handle: HomogeneousMeshPlan;
  private readonly mod: AlembicWasmModule;

  constructor(handle: HomogeneousMeshPlan, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  getInitialMesh(copy = true): RenderMeshData {
    const buf = callWasm(this.mod, () => this.handle.getInitialBuffer());
    try {
      return extractRenderMeshData(this.mod, buf, copy);
    } finally {
      buf.delete();
    }
  }

  evaluateAtTime(
    timeSeconds: number,
    options?: { interpolate?: boolean; copy?: boolean }
  ): { positions: Float32Array; normals: Float32Array } {
    const interpolate = options?.interpolate ?? true;
    const copy = options?.copy ?? false;
    callWasm(this.mod, () => this.handle.evaluateAtTime(timeSeconds, interpolate));
    return {
      positions: readFloat32View(this.mod, this.handle.getPositionsView(), copy),
      normals: readFloat32View(this.mod, this.handle.getNormalsView(), copy),
    };
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

export class IPolyMesh implements Disposable {
  readonly kind = "PolyMesh" as const;
  readonly object: IObject;
  readonly handle: IPolyMeshWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.IPolyMeshWrap(this.object.handle));
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

  getSample(selector?: SampleSelectorInput, copy = true): PolyMeshSample {
    const { mode, value } = resolveSampleSelector(selector);
    const raw = callWasm(this.mod, () => this.handle.getRawSample(mode, value));
    const velocities =
      raw.velocities.length > 0 ? readFloat32View(this.mod, raw.velocities, copy) : null;
    return {
      positions: readFloat32View(this.mod, raw.positions, copy),
      velocities,
      faceIndices: readInt32View(this.mod, raw.faceIndices, copy),
      faceCounts: readInt32View(this.mod, raw.faceCounts, copy),
      selfBounds: fromBox3dDesc(raw.selfBounds),
    };
  }

  getSelfBounds(selector?: SampleSelectorInput): Box3d | null {
    const { mode, value } = resolveSampleSelector(selector);
    return fromBox3dDesc(callWasm(this.mod, () => this.handle.getSelfBounds(mode, value)));
  }

  getUVsParam(): IGeomParam | null {
    const raw = callWasm(this.mod, () => this.handle.getUVsParam());
    return raw ? new IGeomParam(raw, this.mod) : null;
  }

  getNormalsParam(): IGeomParam | null {
    const raw = callWasm(this.mod, () => this.handle.getNormalsParam());
    return raw ? new IGeomParam(raw, this.mod) : null;
  }

  getFaceSetNames(): string[] {
    return callWasm(this.mod, () => this.handle.getFaceSetNames());
  }

  hasFaceSet(name: string): boolean {
    return callWasm(this.mod, () => this.handle.hasFaceSet(name));
  }

  getFaceSet(name: string): IFaceSet | null {
    const raw = callWasm(this.mod, () => this.handle.getFaceSet(name));
    return raw ? new IFaceSet(raw, this.mod) : null;
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
    options?: BuildPolyMeshRenderOptions
  ): RenderMeshData {
    const { mode, value } = resolveSampleSelector(selector);
    const reverseWinding = options?.reverseWinding ?? true;
    const flatNormals = options?.flatNormals ?? false;
    const velocityDt = options?.velocityDt ?? 0;
    const buf = callWasm(this.mod, () =>
      this.handle.buildRenderBuffer(mode, value, reverseWinding, flatNormals, velocityDt)
    );
    try {
      return extractRenderMeshData(this.mod, buf, true);
    } finally {
      buf.delete();
    }
  }

  createHomogeneousEvaluator(options?: {
    reverseWinding?: boolean;
    flatNormals?: boolean;
  }): HomogeneousMeshEvaluator {
    const plan = callWasm(this.mod, () =>
      this.handle.createHomogeneousPlan(options?.reverseWinding ?? true, options?.flatNormals ?? false)
    );
    return new HomogeneousMeshEvaluator(plan, this.mod);
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

export interface CreateOPolyMeshOptions {
  timeSamplingIndex?: number;
  uvSourceName?: string;
  metaData?: MetaDataMap;
}

export class OPolyMesh implements Disposable {
  readonly handle: OPolyMeshWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateOPolyMeshOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOPolyMesh(
        parent.handle,
        name,
        options?.timeSamplingIndex ?? 0,
        normalizeMetaData(options?.metaData)
      )
    );
    if (options?.uvSourceName) {
      this.setUVSourceName(options.uvSourceName);
    }
  }

  get object(): OObject {
    return new OObject(callWasm(this.mod, () => this.handle.getObject()), this.mod);
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  setUVSourceName(name: string): void {
    callWasm(this.mod, () => this.handle.setUVSourceName(name));
  }

  setSample(sample: PolyMeshSampleInput): void {
    const pos =
      sample.positions instanceof Float32Array
        ? sample.positions
        : Float32Array.from(sample.positions);
    const faceIndices = sample.faceIndices
      ? sample.faceIndices instanceof Int32Array
        ? sample.faceIndices
        : Int32Array.from(sample.faceIndices)
      : null;
    const faceCounts = sample.faceCounts
      ? sample.faceCounts instanceof Int32Array
        ? sample.faceCounts
        : Int32Array.from(sample.faceCounts)
      : null;
    const vel = sample.velocities
      ? sample.velocities instanceof Float32Array
        ? sample.velocities
        : Float32Array.from(sample.velocities)
      : null;
    const uvs = sample.uvs
      ? sample.uvs instanceof Float32Array
        ? sample.uvs
        : Float32Array.from(sample.uvs)
      : null;
    const uvIndices = sample.uvIndices
      ? sample.uvIndices instanceof Uint32Array
        ? sample.uvIndices
        : Uint32Array.from(sample.uvIndices)
      : null;
    const normals = sample.normals
      ? sample.normals instanceof Float32Array
        ? sample.normals
        : Float32Array.from(sample.normals)
      : null;
    const normalIndices = sample.normalIndices
      ? sample.normalIndices instanceof Uint32Array
        ? sample.normalIndices
        : Uint32Array.from(sample.normalIndices)
      : null;

    const ptrs = getAlembicArena().stageViews([
      pos,
      faceIndices,
      faceCounts,
      vel,
      uvs,
      uvIndices,
      normals,
      normalIndices,
    ]);

    callWasm(this.mod, () =>
      this.handle.setSample(
        ptrs[0]!,
        Math.floor(pos.length / 3),
        ptrs[1]!,
        faceIndices ? faceIndices.length : 0,
        ptrs[2]!,
        faceCounts ? faceCounts.length : 0,
        ptrs[3]!,
        vel ? Math.floor(vel.length / 3) : 0,
        ptrs[4]!,
        uvs ? Math.floor(uvs.length / 2) : 0,
        ptrs[5]!,
        uvIndices ? uvIndices.length : 0,
        sample.uvScope ?? GeometryScope.FaceVarying,
        ptrs[6]!,
        normals ? Math.floor(normals.length / 3) : 0,
        ptrs[7]!,
        normalIndices ? normalIndices.length : 0,
        sample.normalScope ?? GeometryScope.FaceVarying,
        toBox3dDesc(sample.selfBounds)
      )
    );
  }

  setFromPrevious(): void {
    callWasm(this.mod, () => this.handle.setFromPrevious());
  }

  setTimeSampling(timeSamplingIndex: number): void {
    callWasm(this.mod, () => this.handle.setTimeSampling(timeSamplingIndex));
  }

  createFaceSet(name: string): OFaceSet {
    return new OFaceSet(callWasm(this.mod, () => this.handle.createFaceSet(name)), undefined, undefined, this.mod);
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
