import type {
  AlembicWasmModule,
  IObjectWrap,
  ISubDWrap,
  OSubDWrap,
} from "../../wasm/bindings.js";
import { readFloat32View, readInt32View } from "../../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { IGeomParam } from "../geomParam.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import { GeometryScope, TopologyVariance, fromBox3dDesc, type Box3d } from "../types.js";
import { IObject, OObject } from "../object.js";
import { IFaceSet, OFaceSet } from "./faceSet.js";
import { extractRenderMeshData, type RenderMeshData } from "./polyMesh.js";

export type SubdivisionScheme = "catmull-clark" | "loop" | "bilinear" | (string & {});

export interface SubDSample {
  positions: Float32Array;
  velocities: Float32Array | null;
  faceIndices: Int32Array;
  faceCounts: Int32Array;
  subdivisionScheme: SubdivisionScheme;
  creaseIndices: Int32Array | null;
  creaseLengths: Int32Array | null;
  creaseSharpnesses: Float32Array | null;
  cornerIndices: Int32Array | null;
  cornerSharpnesses: Float32Array | null;
  holes: Int32Array | null;
  interpolateBoundary: number;
  faceVaryingInterpolateBoundary: number;
  faceVaryingPropagateCorners: number;
  selfBounds: Box3d | null;
}

export interface SubDSampleInput {
  positions: Float32Array | readonly number[];
  faceIndices?: Int32Array | readonly number[];
  faceCounts?: Int32Array | readonly number[];
  subdivisionScheme?: SubdivisionScheme;
  creaseIndices?: Int32Array | readonly number[];
  creaseLengths?: Int32Array | readonly number[];
  creaseSharpnesses?: Float32Array | readonly number[];
  cornerIndices?: Int32Array | readonly number[];
  cornerSharpnesses?: Float32Array | readonly number[];
  holes?: Int32Array | readonly number[];
  interpolateBoundary?: number;
  faceVaryingInterpolateBoundary?: number;
  faceVaryingPropagateCorners?: number;
  velocities?: Float32Array | readonly number[];
  uvs?: Float32Array | readonly number[];
  uvIndices?: Uint32Array | readonly number[];
  uvScope?: GeometryScope;
}

export class ISubD implements Disposable {
  readonly kind = "SubD" as const;
  readonly object: IObject;
  readonly handle: ISubDWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.ISubDWrap(this.object.handle));
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

  getSample(selector?: SampleSelectorInput, copy = true): SubDSample {
    const { mode, value } = resolveSampleSelector(selector);
    const raw = callWasm(this.mod, () => this.handle.getRawSample(mode, value));
    return {
      positions: readFloat32View(this.mod, raw.positions, copy),
      velocities: raw.velocities.length > 0 ? readFloat32View(this.mod, raw.velocities, copy) : null,
      faceIndices: readInt32View(this.mod, raw.faceIndices, copy),
      faceCounts: readInt32View(this.mod, raw.faceCounts, copy),
      subdivisionScheme: raw.subdivisionScheme || "catmull-clark",
      creaseIndices:
        raw.creaseIndices.length > 0 ? readInt32View(this.mod, raw.creaseIndices, copy) : null,
      creaseLengths:
        raw.creaseLengths.length > 0 ? readInt32View(this.mod, raw.creaseLengths, copy) : null,
      creaseSharpnesses:
        raw.creaseSharpnesses.length > 0
          ? readFloat32View(this.mod, raw.creaseSharpnesses, copy)
          : null,
      cornerIndices:
        raw.cornerIndices.length > 0 ? readInt32View(this.mod, raw.cornerIndices, copy) : null,
      cornerSharpnesses:
        raw.cornerSharpnesses.length > 0
          ? readFloat32View(this.mod, raw.cornerSharpnesses, copy)
          : null,
      holes: raw.holes.length > 0 ? readInt32View(this.mod, raw.holes, copy) : null,
      interpolateBoundary: raw.interpolateBoundary,
      faceVaryingInterpolateBoundary: raw.faceVaryingInterpolateBoundary,
      faceVaryingPropagateCorners: raw.faceVaryingPropagateCorners,
      selfBounds: fromBox3dDesc(raw.selfBounds),
    };
  }

  getUVsParam(): IGeomParam | null {
    const raw = callWasm(this.mod, () => this.handle.getUVsParam());
    return raw ? new IGeomParam(raw, this.mod) : null;
  }

  getFaceSetNames(): string[] {
    return callWasm(this.mod, () => this.handle.getFaceSetNames());
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
    options?: { subdLevel?: number; reverseWinding?: boolean }
  ): RenderMeshData {
    const { mode, value } = resolveSampleSelector(selector);
    const subdLevel = options?.subdLevel ?? 1;
    const reverseWinding = options?.reverseWinding ?? true;
    const buf = callWasm(this.mod, () =>
      this.handle.buildRenderBuffer(mode, value, subdLevel, reverseWinding)
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

export interface CreateOSubDOptions {
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class OSubD implements Disposable {
  readonly handle: OSubDWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateOSubDOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOSubD(
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

  setSample(sample: SubDSampleInput): void {
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
    const creaseIndices = sample.creaseIndices
      ? sample.creaseIndices instanceof Int32Array
        ? sample.creaseIndices
        : Int32Array.from(sample.creaseIndices)
      : null;
    const creaseLengths = sample.creaseLengths
      ? sample.creaseLengths instanceof Int32Array
        ? sample.creaseLengths
        : Int32Array.from(sample.creaseLengths)
      : null;
    const creaseSharpnesses = sample.creaseSharpnesses
      ? sample.creaseSharpnesses instanceof Float32Array
        ? sample.creaseSharpnesses
        : Float32Array.from(sample.creaseSharpnesses)
      : null;
    const cornerIndices = sample.cornerIndices
      ? sample.cornerIndices instanceof Int32Array
        ? sample.cornerIndices
        : Int32Array.from(sample.cornerIndices)
      : null;
    const cornerSharpnesses = sample.cornerSharpnesses
      ? sample.cornerSharpnesses instanceof Float32Array
        ? sample.cornerSharpnesses
        : Float32Array.from(sample.cornerSharpnesses)
      : null;
    const holes = sample.holes
      ? sample.holes instanceof Int32Array
        ? sample.holes
        : Int32Array.from(sample.holes)
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

    const ptrs = getAlembicArena().stageViews([
      pos,
      faceIndices,
      faceCounts,
      creaseIndices,
      creaseLengths,
      creaseSharpnesses,
      cornerIndices,
      cornerSharpnesses,
      holes,
      vel,
      uvs,
      uvIndices,
    ]);

    callWasm(this.mod, () =>
      this.handle.setSample(
        ptrs[0]!,
        Math.floor(pos.length / 3),
        ptrs[1]!,
        faceIndices ? faceIndices.length : 0,
        ptrs[2]!,
        faceCounts ? faceCounts.length : 0,
        sample.subdivisionScheme ?? "catmull-clark",
        ptrs[3]!,
        creaseIndices ? creaseIndices.length : 0,
        ptrs[4]!,
        creaseLengths ? creaseLengths.length : 0,
        ptrs[5]!,
        creaseSharpnesses ? creaseSharpnesses.length : 0,
        ptrs[6]!,
        cornerIndices ? cornerIndices.length : 0,
        ptrs[7]!,
        cornerSharpnesses ? cornerSharpnesses.length : 0,
        ptrs[8]!,
        holes ? holes.length : 0,
        sample.interpolateBoundary ?? -1,
        sample.faceVaryingInterpolateBoundary ?? -1,
        sample.faceVaryingPropagateCorners ?? -1,
        ptrs[9]!,
        vel ? Math.floor(vel.length / 3) : 0,
        ptrs[10]!,
        uvs ? Math.floor(uvs.length / 2) : 0,
        ptrs[11]!,
        uvIndices ? uvIndices.length : 0,
        sample.uvScope ?? GeometryScope.FaceVarying
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
