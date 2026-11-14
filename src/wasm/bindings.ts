export interface EmbindHandle {
  delete(): void;
  isDeleted(): boolean;
}

export interface BufferViewDesc {
  ptr: number;
  length: number;
  pod: number;
  extent: number;
  byteLength: number;
}

export interface Box3dDesc {
  hasValue: boolean;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface RawArchiveInfo {
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

export interface RawTimeSamplingInfo {
  isUniform: boolean;
  isCyclic: boolean;
  isAcyclic: boolean;
  numSamplesPerCycle: number;
  timePerCycle: number;
  storedTimes: number[];
  maxNumSamples: number;
}

export interface RawPropertyHeaderInfo {
  name: string;
  propertyType: number;
  pod: number;
  extent: number;
  interpretation: string;
  isCompound: boolean;
  isScalar: boolean;
  isArray: boolean;
  isGeomParam: boolean;
  metaData: Record<string, string>;
}

export interface RawXformOpDesc {
  type: number;
  hint: number;
  numChannels: number;
  isTranslateOp?: boolean;
  isScaleOp?: boolean;
  isRotateOp?: boolean;
  isRotateXOp?: boolean;
  isRotateYOp?: boolean;
  isRotateZOp?: boolean;
  isMatrixOp?: boolean;
  channels: number[];
}

export interface RawFilmBackOpDesc {
  type: number;
  hint: string;
  numChannels: number;
  channels: number[];
}

export interface RawCameraSample {
  focalLength: number;
  horizontalAperture: number;
  horizontalFilmOffset: number;
  verticalAperture: number;
  verticalFilmOffset: number;
  lensSqueezeRatio: number;
  overScanLeft: number;
  overScanRight: number;
  overScanTop: number;
  overScanBottom: number;
  fStop: number;
  focusDistance: number;
  shutterOpen: number;
  shutterClose: number;
  nearClippingPlane: number;
  farClippingPlane: number;
  screenWindow: [number, number, number, number];
  childBounds: Box3dDesc;
  filmBackOps: RawFilmBackOpDesc[];
}

export interface RawDrawGroupDesc {
  start: number;
  count: number;
  materialIndex: number;
  faceSetName: string;
}

export interface RawPolyMeshSample {
  positions: BufferViewDesc;
  velocities: BufferViewDesc;
  faceIndices: BufferViewDesc;
  faceCounts: BufferViewDesc;
  selfBounds: Box3dDesc;
}

export interface RawSubDSample {
  positions: BufferViewDesc;
  velocities: BufferViewDesc;
  faceIndices: BufferViewDesc;
  faceCounts: BufferViewDesc;
  subdivisionScheme: string;
  creaseIndices: BufferViewDesc;
  creaseLengths: BufferViewDesc;
  creaseSharpnesses: BufferViewDesc;
  cornerIndices: BufferViewDesc;
  cornerSharpnesses: BufferViewDesc;
  holes: BufferViewDesc;
  interpolateBoundary: number;
  faceVaryingInterpolateBoundary: number;
  faceVaryingPropagateCorners: number;
  selfBounds: Box3dDesc;
}

export interface RawCurvesSample {
  positions: BufferViewDesc;
  velocities: BufferViewDesc;
  positionWeights: BufferViewDesc;
  numVertices: BufferViewDesc;
  type: number;
  wrap: number;
  basis: number;
  knots: BufferViewDesc;
  orders: BufferViewDesc;
  numCurves: number;
  selfBounds: Box3dDesc;
}

export interface RawPointsSample {
  positions: BufferViewDesc;
  ids: BufferViewDesc;
  velocities: BufferViewDesc;
  selfBounds: Box3dDesc;
}

export interface RawNuPatchSample {
  positions: BufferViewDesc;
  velocities: BufferViewDesc;
  positionWeights: BufferViewDesc;
  numU: number;
  numV: number;
  uOrder: number;
  vOrder: number;
  uKnot: BufferViewDesc;
  vKnot: BufferViewDesc;
  hasTrimCurve: boolean;
  selfBounds: Box3dDesc;
}

export interface RawMaterialNodeConnection {
  inputName: string;
  connectedNodeName: string;
  connectedOutputName: string;
}

export interface RawMaterialNodeInfo {
  name: string;
  target: string;
  nodeType: string;
  parameters: ICompoundWrap | null;
  connections: RawMaterialNodeConnection[];
}

export interface RawFlattenedMaterialNodeInfo {
  name: string;
  target: string;
  nodeType: string;
  parameters: RawFlattenedShaderParamEntry[];
  connections: RawMaterialNodeConnection[];
}

export interface RawMaterialTerminalInfo {
  nodeName: string;
  outputName: string;
}

export interface RawMaterialInterfaceMapping {
  interfaceParamName: string;
  mapToNodeName: string;
  mapToParamName: string;
}

export interface RawFlattenedShaderParamEntry {
  name: string;
  parent: ICompoundWrap;
  propertyType?: number;
  pod?: number;
  extent?: number;
  interpretation?: string;
}

export interface ArchiveReaderContext extends EmbindHandle {
  dataPtr(): number;
  byteLength(): number;
  open(): void;
  close(): void;
  isClosed(): boolean;
  getCoreType(): string;
}

export interface IArchiveWrap extends EmbindHandle {
  getInfo(): RawArchiveInfo;
  getCoreType(): string;
  getNumTimeSamplings(): number;
  getTimeSamplingInfo(index: number): RawTimeSamplingInfo;
  getArchiveBounds(selectorMode: number, selectorValue: number): Box3dDesc;
  echo(): string;
  close(): void;
  isClosed(): boolean;
}

export interface ArchiveWriterContext extends EmbindHandle {
  addTimeSampling(kind: number, timePerCycle: number, timesPtr: number, timesCount: number): number;
  setArchiveBounds(bounds: Box3dDesc, tsIndex: number): void;
  finalize(): BufferViewDesc;
  dispose(): void;
  isFinalized(): boolean;
}

export interface IScalarWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getPod(): number;
  getExtent(): number;
  getInterpretation(): string;
  getMetaData(): Record<string, string>;
  getNumSamples(): number;
  isConstant(): boolean;
  getTimeSamplingIndex(): number;
  getNumericSample(selectorMode: number, selectorValue: number): BufferViewDesc;
  getFloat16AsFloat32Sample(selectorMode: number, selectorValue: number): BufferViewDesc;
  getSpecialSample(selectorMode: number, selectorValue: number): Array<string | boolean>;
}

export interface IArrayWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getPod(): number;
  getExtent(): number;
  getInterpretation(): string;
  getMetaData(): Record<string, string>;
  getNumSamples(): number;
  isConstant(): boolean;
  getTimeSamplingIndex(): number;
  getNumericSample(selectorMode: number, selectorValue: number): BufferViewDesc;
  getFloat16AsFloat32Sample(selectorMode: number, selectorValue: number): BufferViewDesc;
  getSpecialSample(selectorMode: number, selectorValue: number): Array<string | boolean>;
  getDimensions(selectorMode: number, selectorValue: number): number[];
}

export interface GenericIGeomParam extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  isIndexed(): boolean;
  getScope(): number;
  getPod(): number;
  getExtent(): number;
  getArrayExtent(): number;
  getInterpretation(): string;
  getMetaData(): Record<string, string>;
  getNumSamples(): number;
  isConstant(): boolean;
  getTimeSamplingIndex(): number;
  getValueProperty(): IArrayWrap;
  getIndexProperty(): IArrayWrap | null;
  getExpandedNumericSample(selectorMode: number, selectorValue: number): BufferViewDesc;
}

export interface ICompoundWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getMetaData(): Record<string, string>;
  getNumProperties(): number;
  getPropertyHeaderInfo(index: number): RawPropertyHeaderInfo;
  getPropertyHeaderByName(name: string): RawPropertyHeaderInfo | null;
  hasProperty(name: string): boolean;
  getCompoundProperty(name: string): ICompoundWrap;
  getScalarProperty(name: string): IScalarWrap;
  getArrayProperty(name: string): IArrayWrap;
  getGeomParam(name: string): GenericIGeomParam;
}

export interface OScalarWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getPod(): number;
  getExtent(): number;
  getNumSamples(): number;
  setNumericSample(ptr: number, byteLength: number): void;
  setFloat32AsFloat16Sample(ptr: number, floatCount: number): void;
  setSpecialSample(jsArray: Array<string | boolean>): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
}

export interface OArrayWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getPod(): number;
  getExtent(): number;
  getNumSamples(): number;
  setNumericSample(ptr: number, tupleCount: number): void;
  setFloat32AsFloat16Sample(ptr: number, tupleCount: number): void;
  setSpecialSample(jsArray: Array<string | boolean>): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
}

export interface GenericOGeomParam extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  isIndexed(): boolean;
  getScope(): number;
  getPod(): number;
  getExtent(): number;
  getNumSamples(): number;
  setNumericSample(valsPtr: number, valsTupleCount: number, indicesPtr: number, indicesCount: number): void;
  setSpecialSample(jsVals: Array<string | boolean>, indicesPtr: number, indicesCount: number): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
}

export interface OCompoundWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getMetaData(): Record<string, string>;
  createCompoundProperty(name: string, metaObj: Record<string, string>): OCompoundWrap;
  createScalarProperty(
    name: string,
    pod: number,
    extent: number,
    interpretation: string,
    tsIndex: number,
    metaObj: Record<string, string>
  ): OScalarWrap;
  createArrayProperty(
    name: string,
    pod: number,
    extent: number,
    interpretation: string,
    tsIndex: number,
    metaObj: Record<string, string>
  ): OArrayWrap;
  createGeomParam(
    name: string,
    pod: number,
    extent: number,
    arrayExtent: number,
    interpretation: string,
    isIndexed: boolean,
    scope: number,
    tsIndex: number,
    extraMeta: Record<string, string>
  ): GenericOGeomParam;
}

export interface IObjectWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getFullName(): string;
  getSchemaType(): string;
  getSchemaString(): string;
  getMetaData(): Record<string, string>;
  getNumChildren(): number;
  getChildByIndex(index: number): IObjectWrap | null;
  getChildByName(name: string): IObjectWrap | null;
  hasChild(name: string): boolean;
  getProperties(): ICompoundWrap;
  isInstanceRoot(): boolean;
  isInstanceDescendant(): boolean;
  instanceSourcePath(): string;
  getVisibility(selectorMode: number, selectorValue: number): number;
  isAncestorInvisible(selectorMode: number, selectorValue: number): boolean;
  getVisibilityProperty(): IScalarWrap | null;
}

export interface OObjectWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getFullName(): string;
  getMetaData(): Record<string, string>;
  getNumChildren(): number;
  addChild(name: string, metaObj: Record<string, string>): OObjectWrap;
  addChildInstance(target: OObjectWrap, name: string): boolean;
  getProperties(): OCompoundWrap;
  setVisibility(visibilityState: number, tsIndex: number): void;
}

export interface RenderMeshBuffer extends EmbindHandle {
  hasNormals: boolean;
  hasUVs: boolean;
  hasColors: boolean;
  getPositionsView(): BufferViewDesc;
  getNormalsView(): BufferViewDesc;
  getUVsView(): BufferViewDesc;
  getColorsView(): BufferViewDesc;
  getIndicesView(): BufferViewDesc;
  getVertexCount(): number;
  getIndexCount(): number;
  getGroups(): RawDrawGroupDesc[];
  getBounds(): Box3dDesc;
}

export interface HomogeneousMeshPlan extends EmbindHandle {
  getInitialBuffer(): RenderMeshBuffer;
  evaluateAtTime(timeSeconds: number, interpolate: boolean): void;
  getPositionsView(): BufferViewDesc;
  getNormalsView(): BufferViewDesc;
}

export interface CurveTessellationBuffer extends EmbindHandle {
  getSegmentPositionsView(): BufferViewDesc;
  getSegmentWidthsView(): BufferViewDesc;
}

export interface IXformWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  isConstantIdentity(): boolean;
  getTimeSamplingIndex(): number;
  getMatrix(selectorMode: number, selectorValue: number): BufferViewDesc;
  getInterpolatedMatrix(timeSeconds: number): BufferViewDesc;
  getInheritsXforms(selectorMode: number, selectorValue: number): boolean;
  getSampleOps(selectorMode: number, selectorValue: number): RawXformOpDesc[];
  getChildBounds(selectorMode: number, selectorValue: number): Box3dDesc;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
}

export interface OXformWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setMatrixSample(matrix16DoublePtr: number, inherits: boolean): void;
  setOpsSample(opsArray: Array<{ type: number; hint?: number; channels: number[] }>, inherits: boolean): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface ICameraWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  getTimeSamplingIndex(): number;
  getSample(selectorMode: number, selectorValue: number): RawCameraSample;
  getChildBounds(selectorMode: number, selectorValue: number): Box3dDesc;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
}

export interface OCameraWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setSample(sampleObj: Record<string, unknown>): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface ILightWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  getTimeSamplingIndex(): number;
  getCameraSchema(): ICameraWrap | null;
  getChildBounds(selectorMode: number, selectorValue: number): Box3dDesc;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
}

export interface OLightWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setCameraSample(sampleObj: Record<string, unknown>): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface IFaceSetWrap extends EmbindHandle {
  valid(): boolean;
  getName(): string;
  getFullName(): string;
  getNumSamples(): number;
  isConstant(): boolean;
  getFaceExclusivity(): number;
  getTimeSamplingIndex(): number;
  getFaces(selectorMode: number, selectorValue: number): BufferViewDesc;
  getSelfBounds(selectorMode: number, selectorValue: number): Box3dDesc;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
  getObject(): IObjectWrap;
}

export interface OFaceSetWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setFaces(facesInt32Ptr: number, count: number): void;
  setFaceExclusivity(exclusivity: number): void;
  getFaceExclusivity(): number;
  setTimeSampling(tsIndex: number): void;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface IPolyMeshWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  getTopologyVariance(): number;
  getTimeSamplingIndex(): number;
  getRawSample(selectorMode: number, selectorValue: number): RawPolyMeshSample;
  getSelfBounds(selectorMode: number, selectorValue: number): Box3dDesc;
  getUVsParam(): GenericIGeomParam | null;
  getNormalsParam(): GenericIGeomParam | null;
  getFaceSetNames(): string[];
  hasFaceSet(name: string): boolean;
  getFaceSet(name: string): IFaceSetWrap | null;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
  buildRenderBuffer(
    selectorMode: number,
    selectorValue: number,
    reverseWinding: boolean,
    flatNormals: boolean,
    velocityDt: number
  ): RenderMeshBuffer;
  createHomogeneousPlan(reverseWinding: boolean, flatNormals: boolean): HomogeneousMeshPlan;
}

export interface OPolyMeshWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setSample(
    posPtr: number,
    posCount: number,
    faceIndicesPtr: number,
    faceIndicesCount: number,
    faceCountsPtr: number,
    faceCountsCount: number,
    velPtr: number,
    velCount: number,
    uvsPtr: number,
    uvsCount: number,
    uvIndicesPtr: number,
    uvIndicesCount: number,
    uvScope: number,
    normalsPtr: number,
    normalsCount: number,
    normalIndicesPtr: number,
    normalIndicesCount: number,
    normalScope: number,
    selfBounds: Box3dDesc
  ): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  setUVSourceName(name: string): void;
  createFaceSet(name: string): OFaceSetWrap;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface ISubDWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  getTopologyVariance(): number;
  getTimeSamplingIndex(): number;
  getRawSample(selectorMode: number, selectorValue: number): RawSubDSample;
  getUVsParam(): GenericIGeomParam | null;
  getFaceSetNames(): string[];
  getFaceSet(name: string): IFaceSetWrap | null;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
  buildRenderBuffer(
    selectorMode: number,
    selectorValue: number,
    subdLevel: number,
    reverseWinding: boolean
  ): RenderMeshBuffer;
}

export interface OSubDWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setSample(
    posPtr: number,
    posCount: number,
    faceIndicesPtr: number,
    faceIndicesCount: number,
    faceCountsPtr: number,
    faceCountsCount: number,
    scheme: string,
    creaseIndicesPtr: number,
    creaseIndicesCount: number,
    creaseLengthsPtr: number,
    creaseLengthsCount: number,
    creaseSharpnessesPtr: number,
    creaseSharpnessesCount: number,
    cornerIndicesPtr: number,
    cornerIndicesCount: number,
    cornerSharpnessesPtr: number,
    cornerSharpnessesCount: number,
    holesPtr: number,
    holesCount: number,
    interpolateBoundary: number,
    faceVaryingInterpolateBoundary: number,
    faceVaryingPropagateCorners: number,
    velPtr: number,
    velCount: number,
    uvsPtr: number,
    uvsCount: number,
    uvIndicesPtr: number,
    uvIndicesCount: number,
    uvScope: number
  ): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  createFaceSet(name: string): OFaceSetWrap;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface ICurvesWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  getTopologyVariance(): number;
  getTimeSamplingIndex(): number;
  getRawSample(selectorMode: number, selectorValue: number): RawCurvesSample;
  getWidthsParam(): GenericIGeomParam | null;
  getUVsParam(): GenericIGeomParam | null;
  getNormalsParam(): GenericIGeomParam | null;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
  evaluateForRender(selectorMode: number, selectorValue: number, segmentsPerSpan: number): CurveTessellationBuffer;
}

export interface OCurvesWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setSample(
    posPtr: number,
    posCount: number,
    numVertsPtr: number,
    numCurves: number,
    curveType: number,
    wrapPeriodicity: number,
    basisType: number,
    widthsPtr: number,
    widthsCount: number,
    widthScope: number,
    uvsPtr: number,
    uvsCount: number,
    uvScope: number,
    normalsPtr: number,
    normalsCount: number,
    normalScope: number,
    weightsPtr: number,
    weightsCount: number,
    ordersPtr: number,
    ordersCount: number,
    knotsPtr: number,
    knotsCount: number,
    velPtr: number,
    velCount: number
  ): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface IPointsWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  getTimeSamplingIndex(): number;
  getRawSample(selectorMode: number, selectorValue: number): RawPointsSample;
  getWidthsParam(): GenericIGeomParam | null;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
}

export interface OPointsWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setSample(
    posPtr: number,
    posCount: number,
    idsUint64Ptr: number,
    idsCount: number,
    velPtr: number,
    velCount: number,
    widthsPtr: number,
    widthsCount: number,
    widthScope: number
  ): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface INuPatchWrap extends EmbindHandle {
  valid(): boolean;
  getNumSamples(): number;
  isConstant(): boolean;
  getTopologyVariance(): number;
  getTimeSamplingIndex(): number;
  getRawSample(selectorMode: number, selectorValue: number): RawNuPatchSample;
  getUVsParam(): GenericIGeomParam | null;
  getNormalsParam(): GenericIGeomParam | null;
  getArbGeomParams(): ICompoundWrap | null;
  getUserProperties(): ICompoundWrap | null;
  buildRenderBuffer(
    selectorMode: number,
    selectorValue: number,
    uSegments: number,
    vSegments: number,
    reverseWinding: boolean
  ): RenderMeshBuffer;
}

export interface ONuPatchWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumSamples(): number;
  setSample(
    posPtr: number,
    posCount: number,
    numU: number,
    numV: number,
    uOrder: number,
    vOrder: number,
    uKnotPtr: number,
    uKnotCount: number,
    vKnotPtr: number,
    vKnotCount: number,
    weightsPtr: number,
    weightsCount: number,
    velPtr: number,
    velCount: number
  ): void;
  setFromPrevious(): void;
  setTimeSampling(tsIndex: number): void;
  getArbGeomParams(): OCompoundWrap;
  getUserProperties(): OCompoundWrap;
}

export interface IMaterialWrap extends EmbindHandle {
  valid(): boolean;
  getTargetNames(): string[];
  getShaderTypesForTarget(targetName: string): string[];
  getShader(target: string, shaderType: string): string;
  getShaderParameters(target: string, shaderType: string): ICompoundWrap | null;
  getNumNetworkNodes(): number;
  getNetworkNodeNames(): string[];
  getNetworkNodeInfo(nodeName: string): RawMaterialNodeInfo | null;
  getNetworkTerminalTargetNames(): string[];
  getNetworkTerminalShaderTypesForTarget(targetName: string): string[];
  getNetworkTerminal(target: string, shaderType: string): RawMaterialTerminalInfo | null;
  getNetworkInterfaceParameters(): ICompoundWrap | null;
  getNetworkInterfaceParameterMappings(): RawMaterialInterfaceMapping[];
}

export interface OMaterialWrap extends EmbindHandle {
  getObject(): OObjectWrap | null;
  setShader(target: string, shaderType: string, shaderName: string): void;
  getShaderParameters(target: string, shaderType: string): OCompoundWrap;
  addNetworkNode(nodeName: string, target: string, nodeType: string): void;
  setNetworkNodeConnection(
    nodeName: string,
    inputName: string,
    connectedNodeName: string,
    connectedOutputName: string
  ): void;
  getNetworkNodeParameters(nodeName: string): OCompoundWrap;
  setNetworkTerminal(target: string, shaderType: string, nodeName: string, outputName: string): void;
  setNetworkInterfaceParameterMapping(
    interfaceParamName: string,
    mapToNodeName: string,
    mapToParamName: string
  ): void;
  getNetworkInterfaceParameters(): OCompoundWrap;
}

export interface MaterialFlattenWrap extends EmbindHandle {
  empty(): boolean;
  getTargetNames(): string[];
  getShaderTypesForTarget(targetName: string): string[];
  getShader(target: string, shaderType: string): string;
  getShaderParametersList(target: string, shaderType: string): RawFlattenedShaderParamEntry[];
  getNetworkTerminalTargetNames(): string[];
  getNetworkTerminalShaderTypesForTarget(targetName: string): string[];
  getNetworkTerminal(target: string, shaderType: string): RawMaterialTerminalInfo | null;
  getNumNetworkNodes(): number;
  getNetworkNodeByIndex(index: number): RawFlattenedMaterialNodeInfo | null;
}

export interface ICollectionsWrap extends EmbindHandle {
  valid(): boolean;
  getNumCollections(): number;
  getCollectionName(index: number): string;
  getCollectionByIndex(index: number): IArrayWrap | null;
  getCollectionByName(name: string): IArrayWrap | null;
}

export interface OCollectionsWrap extends EmbindHandle {
  getObject(): OObjectWrap;
  getNumCollections(): number;
  createCollection(name: string, tsIndex: number): OArrayWrap;
  getCollectionByName(name: string): OArrayWrap | null;
}

export interface EmbindClassCtor<T, Args extends unknown[] = []> {
  new (...args: Args): T;
}

export interface AlembicWasmModule {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  getExceptionMessage?(err: unknown): [string, string];
  getCppExceptionMessage(excPtr: number): string;

  // Core & Archive
  createReaderBuffer(byteLength: number): ArchiveReaderContext;
  openReaderArchive(ctx: ArchiveReaderContext): IArchiveWrap;
  openLayeredReaderArchive(ctxs: ArchiveReaderContext[]): IArchiveWrap;
  createWriterArchive(
    appName: string,
    userDescription: string,
    dccFps: number,
    extraMeta: Record<string, string>
  ): ArchiveWriterContext;
  applyLayerPruneMeta(metaObj: Record<string, string>, prune: boolean): Record<string, string>;
  applyLayerReplaceMeta(metaObj: Record<string, string>, replace: boolean): Record<string, string>;
  getAlembicLibraryVersion(): string;
  getAlembicLibraryVersionShort(): string;

  // Objects
  getArchiveTopObject(arch: IArchiveWrap): IObjectWrap;
  getWriterTopObject(ctx: ArchiveWriterContext): OObjectWrap;

  // Reader Schema Ctors
  IXformWrap: EmbindClassCtor<IXformWrap, [IObjectWrap]>;
  ICameraWrap: EmbindClassCtor<ICameraWrap, [IObjectWrap]>;
  ILightWrap: EmbindClassCtor<ILightWrap, [IObjectWrap]>;
  IFaceSetWrap: EmbindClassCtor<IFaceSetWrap, [IObjectWrap]>;
  IPolyMeshWrap: EmbindClassCtor<IPolyMeshWrap, [IObjectWrap]>;
  ISubDWrap: EmbindClassCtor<ISubDWrap, [IObjectWrap]>;
  ICurvesWrap: EmbindClassCtor<ICurvesWrap, [IObjectWrap]>;
  IPointsWrap: EmbindClassCtor<IPointsWrap, [IObjectWrap]>;
  INuPatchWrap: EmbindClassCtor<INuPatchWrap, [IObjectWrap]>;
  IMaterialWrap: EmbindClassCtor<IMaterialWrap, [IObjectWrap]>;
  ICollectionsWrap: EmbindClassCtor<ICollectionsWrap, [IObjectWrap]>;

  // Writer Schema Factories
  createOXform(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OXformWrap;
  createOCamera(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OCameraWrap;
  createOLight(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OLightWrap;
  createOFaceSet(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OFaceSetWrap;
  createOPolyMesh(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OPolyMeshWrap;
  createOSubD(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OSubDWrap;
  createOCurves(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OCurvesWrap;
  createOPoints(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): OPointsWrap;
  createONuPatch(parent: OObjectWrap, name: string, tsIndex: number, metaObj: Record<string, string>): ONuPatchWrap;
  createOMaterial(parent: OObjectWrap, name: string, metaObj: Record<string, string>): OMaterialWrap;
  createOCollections(parent: OObjectWrap, name: string, metaObj: Record<string, string>): OCollectionsWrap;

  // Material Assignment & Flatten Helpers
  assignMaterialToObject(obj: OObjectWrap, materialFullPath: string): void;
  addLocalMaterialToObject(obj: OObjectWrap): OMaterialWrap;
  getObjectMaterialAssignmentPath(obj: IObjectWrap): string;
  getObjectLocalMaterial(obj: IObjectWrap): IMaterialWrap | null;
  flattenObjectMaterial(obj: IObjectWrap): MaterialFlattenWrap;
  flattenMaterialSchema(mat: IMaterialWrap): MaterialFlattenWrap;
}

export interface CreateAlembicModuleOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string, prefix: string) => string;
}

export type CreateAlembicModuleFactory = (
  options?: CreateAlembicModuleOptions
) => Promise<AlembicWasmModule>;
