import type {
  AlembicWasmModule,
  ICurvesWrap,
  IObjectWrap,
  OCurvesWrap,
} from "../../wasm/bindings.js";
import { readFloat32View, readInt32View, readUint8View } from "../../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { IGeomParam } from "../geomParam.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import {
  BasisType,
  CurvePeriodicity,
  CurveType,
  GeometryScope,
  TopologyVariance,
  fromBox3dDesc,
  type Box3d,
} from "../types.js";
import { IObject, OObject } from "../object.js";

export interface CurvesSample {
  positions: Float32Array;
  velocities: Float32Array | null;
  positionWeights: Float32Array | null;
  curvesNumVertices: Int32Array;
  type: CurveType;
  wrap: CurvePeriodicity;
  basis: BasisType;
  knots: Float32Array | null;
  orders: Uint8Array | null;
  numCurves: number;
  selfBounds: Box3d | null;
}

export interface CurvesSampleInput {
  positions: Float32Array | readonly number[];
  curvesNumVertices?: Int32Array | readonly number[];
  type?: CurveType;
  wrap?: CurvePeriodicity;
  basis?: BasisType;
  widths?: Float32Array | readonly number[];
  widthScope?: GeometryScope;
  uvs?: Float32Array | readonly number[];
  uvScope?: GeometryScope;
  normals?: Float32Array | readonly number[];
  normalScope?: GeometryScope;
  positionWeights?: Float32Array | readonly number[];
  orders?: Uint8Array | readonly number[];
  knots?: Float32Array | readonly number[];
  velocities?: Float32Array | readonly number[];
}

export interface EvaluatedCurvesData {
  /** Packed endpoint pairs `[x0,y0,z0, x1,y1,z1, ...]` suitable for `THREE.LineSegments`. */
  segmentPositions: Float32Array;
  segmentWidths: Float32Array | null;
}

export class ICurves implements Disposable {
  readonly kind = "Curves" as const;
  readonly object: IObject;
  readonly handle: ICurvesWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.ICurvesWrap(this.object.handle));
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

  getSample(selector?: SampleSelectorInput, copy = true): CurvesSample {
    const { mode, value } = resolveSampleSelector(selector);
    const raw = callWasm(this.mod, () => this.handle.getRawSample(mode, value));
    return {
      positions: readFloat32View(this.mod, raw.positions, copy),
      velocities: raw.velocities.length > 0 ? readFloat32View(this.mod, raw.velocities, copy) : null,
      positionWeights:
        raw.positionWeights.length > 0 ? readFloat32View(this.mod, raw.positionWeights, copy) : null,
      curvesNumVertices: readInt32View(this.mod, raw.numVertices, copy),
      type: raw.type as CurveType,
      wrap: raw.wrap as CurvePeriodicity,
      basis: raw.basis as BasisType,
      knots: raw.knots.length > 0 ? readFloat32View(this.mod, raw.knots, copy) : null,
      orders: raw.orders.length > 0 ? readUint8View(this.mod, raw.orders, copy) : null,
      numCurves: raw.numCurves,
      selfBounds: fromBox3dDesc(raw.selfBounds),
    };
  }

  getWidthsParam(): IGeomParam | null {
    const raw = callWasm(this.mod, () => this.handle.getWidthsParam());
    return raw ? new IGeomParam(raw, this.mod) : null;
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

  evaluateForRender(selector?: SampleSelectorInput, segmentsPerSpan = 8): EvaluatedCurvesData {
    const { mode, value } = resolveSampleSelector(selector);
    const buf = callWasm(this.mod, () =>
      this.handle.evaluateForRender(mode, value, Math.max(1, segmentsPerSpan))
    );
    try {
      const segPos = readFloat32View(this.mod, buf.getSegmentPositionsView(), true);
      const wDesc = buf.getSegmentWidthsView();
      const segWidths = wDesc.length > 0 ? readFloat32View(this.mod, wDesc, true) : null;
      return {
        segmentPositions: segPos,
        segmentWidths: segWidths,
      };
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

export interface CreateOCurvesOptions {
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class OCurves implements Disposable {
  readonly handle: OCurvesWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateOCurvesOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOCurves(
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

  setSample(sample: CurvesSampleInput): void {
    const pos =
      sample.positions instanceof Float32Array
        ? sample.positions
        : Float32Array.from(sample.positions);
    const numVerts = sample.curvesNumVertices
      ? sample.curvesNumVertices instanceof Int32Array
        ? sample.curvesNumVertices
        : Int32Array.from(sample.curvesNumVertices)
      : null;
    const widths = sample.widths
      ? sample.widths instanceof Float32Array
        ? sample.widths
        : Float32Array.from(sample.widths)
      : null;
    const uvs = sample.uvs
      ? sample.uvs instanceof Float32Array
        ? sample.uvs
        : Float32Array.from(sample.uvs)
      : null;
    const normals = sample.normals
      ? sample.normals instanceof Float32Array
        ? sample.normals
        : Float32Array.from(sample.normals)
      : null;
    const weights = sample.positionWeights
      ? sample.positionWeights instanceof Float32Array
        ? sample.positionWeights
        : Float32Array.from(sample.positionWeights)
      : null;
    const orders = sample.orders
      ? sample.orders instanceof Uint8Array
        ? sample.orders
        : Uint8Array.from(sample.orders)
      : null;
    const knots = sample.knots
      ? sample.knots instanceof Float32Array
        ? sample.knots
        : Float32Array.from(sample.knots)
      : null;
    const vel = sample.velocities
      ? sample.velocities instanceof Float32Array
        ? sample.velocities
        : Float32Array.from(sample.velocities)
      : null;

    const ptrs = getAlembicArena().stageViews([
      pos,
      numVerts,
      widths,
      uvs,
      normals,
      weights,
      orders,
      knots,
      vel,
    ]);

    callWasm(this.mod, () =>
      this.handle.setSample(
        ptrs[0]!,
        Math.floor(pos.length / 3),
        ptrs[1]!,
        numVerts ? numVerts.length : 0,
        sample.type ?? CurveType.Linear,
        sample.wrap ?? CurvePeriodicity.NonPeriodic,
        sample.basis ?? BasisType.NoBasis,
        ptrs[2]!,
        widths ? widths.length : 0,
        sample.widthScope ?? GeometryScope.Vertex,
        ptrs[3]!,
        uvs ? Math.floor(uvs.length / 2) : 0,
        sample.uvScope ?? GeometryScope.Vertex,
        ptrs[4]!,
        normals ? Math.floor(normals.length / 3) : 0,
        sample.normalScope ?? GeometryScope.Vertex,
        ptrs[5]!,
        weights ? weights.length : 0,
        ptrs[6]!,
        orders ? orders.length : 0,
        ptrs[7]!,
        knots ? knots.length : 0,
        ptrs[8]!,
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
