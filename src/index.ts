export {
  initAlembic,
  isAlembicInitialized,
  getAlembicModule,
  type InitAlembicOptions,
} from "./wasm/loader.js";

export {
  AlembicError,
  ArchiveClosedError,
  UnsupportedCoreTypeError,
} from "./core/errors.js";

export {
  PlainOldDataType,
  POD,
  PropertyType,
  GeometryScope,
  TopologyVariance,
  ArchiveCoreType,
  ObjectVisibility,
  FaceSetExclusivity,
  CurveType,
  CurvePeriodicity,
  BasisType,
  XformOperationType,
  FilmBackXformOperationType,
  podByteSize,
  podName,
  type DataType,
  type SchemaKind,
  type Box3d,
  type ArchiveInfo,
  type NumericTypedArray,
  type SampleArrayValue,
} from "./core/types.js";

export {
  normalizeMetaData,
  withLayerPrune,
  withLayerReplace,
  type MetaDataMap,
} from "./core/metadata.js";

export {
  SelectorMode,
  SampleSelector,
  TimeSampling,
  resolveSampleSelector,
  type SampleSelectorInput,
  type TimeSamplingKind,
  type BracketingTimeSamples,
} from "./core/timeSampling.js";

export {
  IArchive,
  OArchive,
  openArchive,
  openArchiveSync,
  openLayeredArchive,
  createArchive,
  createArchiveSync,
  getLibraryVersion,
  getLibraryVersionShort,
  type ArchiveSource,
  type CreateArchiveOptions,
} from "./core/archive.js";

export { IObject, OObject } from "./core/object.js";

export {
  IScalarProperty,
  IArrayProperty,
  ICompoundProperty,
  OScalarProperty,
  OArrayProperty,
  OCompoundProperty,
  type PropertyHeader,
  type ScalarSampleInput,
  type ArraySampleInput,
  type CreatePropertyOptions,
  type CreateGeomParamOptions,
} from "./core/properties.js";

export {
  IGeomParam,
  OGeomParam,
  type IndexedGeomParamSample,
} from "./core/geomParam.js";

export * from "./core/schemas/index.js";
