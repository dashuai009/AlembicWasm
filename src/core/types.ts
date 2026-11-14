import type { Box3dDesc } from "../wasm/bindings.js";

/**
 * Matches Alembic::Util::PlainOldDataType enum values in PlainOldDataType.h.
 */
export enum PlainOldDataType {
  Boolean = 0,
  Uint8 = 1,
  Int8 = 2,
  Uint16 = 3,
  Int16 = 4,
  Uint32 = 5,
  Int32 = 6,
  Uint64 = 7,
  Int64 = 8,
  Float16 = 9,
  Float32 = 10,
  Float64 = 11,
  String = 12,
  Wstring = 13,
  NumPlainOldDataTypes = 14,
  Unknown = 127,
}

export { PlainOldDataType as POD };

export interface DataType {
  pod: PlainOldDataType;
  extent: number;
}

/**
 * Matches Alembic::AbcCoreAbstract::PropertyType.
 */
export enum PropertyType {
  Compound = 0,
  Scalar = 1,
  Array = 2,
}

/**
 * Matches Alembic::AbcGeom::GeometryScope.
 */
export enum GeometryScope {
  Constant = 0,
  Uniform = 1,
  Varying = 2,
  Vertex = 3,
  FaceVarying = 4,
  Unknown = 127,
}

/**
 * Matches Alembic::AbcGeom::MeshTopologyVariance / CurveTopologyVariance.
 */
export enum TopologyVariance {
  Constant = 0,
  Homogeneous = 1,
  Heterogeneous = 2,
}

/**
 * Matches Alembic::AbcCoreFactory::IFactory::CoreType.
 */
export enum ArchiveCoreType {
  HDF5 = 0,
  Ogawa = 2,
  Layer = 3,
  Unknown = 127,
}

/**
 * Matches Alembic::AbcGeom::ObjectVisibility.
 */
export enum ObjectVisibility {
  Deferred = -1,
  Hidden = 0,
  Visible = 1,
}

/**
 * Matches Alembic::AbcGeom::FaceSetExclusivity.
 */
export enum FaceSetExclusivity {
  NonExclusive = 0,
  Exclusive = 1,
}

/**
 * Matches Alembic::AbcGeom::CurveType.
 */
export enum CurveType {
  Cubic = 0,
  Linear = 1,
  VariableOrder = 2,
}

/**
 * Matches Alembic::AbcGeom::CurvePeriodicity.
 */
export enum CurvePeriodicity {
  NonPeriodic = 0,
  Periodic = 1,
}

/**
 * Matches Alembic::AbcGeom::BasisType.
 */
export enum BasisType {
  NoBasis = 0,
  Bezier = 1,
  BSpline = 2,
  CatmullRom = 3,
  Hermite = 4,
  Power = 5,
}

/**
 * Matches Alembic::AbcGeom::XformOperationType.
 */
export enum XformOperationType {
  Scale = 0,
  Translate = 1,
  Rotate = 2,
  Matrix = 3,
  RotateX = 4,
  RotateY = 5,
  RotateZ = 6,
}

/**
 * Matches Alembic::AbcGeom::FilmBackXformOperationType.
 */
export enum FilmBackXformOperationType {
  ScaleFilmBack = 0,
  TranslateFilmBack = 1,
  MatrixFilmBack = 2,
}

export type SchemaKind =
  | "Xform"
  | "PolyMesh"
  | "SubD"
  | "FaceSet"
  | "Camera"
  | "Curves"
  | "Points"
  | "NuPatch"
  | "Light"
  | "Material"
  | "Collections"
  | "None";

export interface Box3d {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ArchiveInfo {
  appName: string;
  libraryVersionString: string;
  apiVersion: number;
  archiveVersion: number;
  dateWritten: string;
  userDescription: string;
  dccFps: number;
  coreType: string;
  hasTimeRange: boolean;
  startTime: number;
  endTime: number;
  numTimeSamplings: number;
  metaData: Record<string, string>;
}

export type NumericTypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array
  | Float32Array
  | Float64Array;

export type SampleArrayValue = NumericTypedArray | boolean[] | string[];

export function fromBox3dDesc(desc: Box3dDesc): Box3d | null {
  if (!desc.hasValue) {
    return null;
  }
  return {
    min: [desc.minX, desc.minY, desc.minZ],
    max: [desc.maxX, desc.maxY, desc.maxZ],
  };
}

export function toBox3dDesc(box?: Box3d | null): Box3dDesc {
  if (!box) {
    return {
      hasValue: false,
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 0,
      maxY: 0,
      maxZ: 0,
    };
  }
  return {
    hasValue: true,
    minX: box.min[0],
    minY: box.min[1],
    minZ: box.min[2],
    maxX: box.max[0],
    maxY: box.max[1],
    maxZ: box.max[2],
  };
}

export function podByteSize(pod: PlainOldDataType): number {
  switch (pod) {
    case PlainOldDataType.Boolean:
    case PlainOldDataType.Uint8:
    case PlainOldDataType.Int8:
      return 1;
    case PlainOldDataType.Uint16:
    case PlainOldDataType.Int16:
    case PlainOldDataType.Float16:
      return 2;
    case PlainOldDataType.Uint32:
    case PlainOldDataType.Int32:
    case PlainOldDataType.Float32:
      return 4;
    case PlainOldDataType.Uint64:
    case PlainOldDataType.Int64:
    case PlainOldDataType.Float64:
      return 8;
    default:
      return 0;
  }
}

export function podName(pod: PlainOldDataType): string {
  switch (pod) {
    case PlainOldDataType.Boolean:
      return "bool_t";
    case PlainOldDataType.Uint8:
      return "uint8_t";
    case PlainOldDataType.Int8:
      return "int8_t";
    case PlainOldDataType.Uint16:
      return "uint16_t";
    case PlainOldDataType.Int16:
      return "int16_t";
    case PlainOldDataType.Uint32:
      return "uint32_t";
    case PlainOldDataType.Int32:
      return "int32_t";
    case PlainOldDataType.Uint64:
      return "uint64_t";
    case PlainOldDataType.Int64:
      return "int64_t";
    case PlainOldDataType.Float16:
      return "float16_t";
    case PlainOldDataType.Float32:
      return "float32_t";
    case PlainOldDataType.Float64:
      return "float64_t";
    case PlainOldDataType.String:
      return "string";
    case PlainOldDataType.Wstring:
      return "wstring";
    default:
      return "unknown";
  }
}
