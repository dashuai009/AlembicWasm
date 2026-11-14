import type {
  AlembicWasmModule,
  IArrayWrap,
  ICompoundWrap,
  IScalarWrap,
  OArrayWrap,
  OCompoundWrap,
  OScalarWrap,
  RawPropertyHeaderInfo,
} from "../wasm/bindings.js";
import { readFloat32View, readNumericBufferView } from "../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../wasm/loader.js";
import { AlembicError, callWasm } from "./errors.js";
import { normalizeMetaData, type MetaDataMap } from "./metadata.js";
import { resolveSampleSelector, type SampleSelectorInput } from "./timeSampling.js";
import {
  GeometryScope,
  PlainOldDataType,
  PropertyType,
  podByteSize,
  type DataType,
  type NumericTypedArray,
  type SampleArrayValue,
} from "./types.js";
import { IGeomParam, OGeomParam } from "./geomParam.js";

export interface PropertyHeader {
  name: string;
  propertyType: PropertyType;
  dataType: DataType;
  interpretation: string;
  isCompound: boolean;
  isScalar: boolean;
  isArray: boolean;
  isGeomParam: boolean;
  metaData: Record<string, string>;
}

function toPropertyHeader(raw: RawPropertyHeaderInfo): PropertyHeader {
  return {
    name: raw.name,
    propertyType: raw.propertyType as PropertyType,
    dataType: {
      pod: raw.pod as PlainOldDataType,
      extent: raw.extent,
    },
    interpretation: raw.interpretation,
    isCompound: raw.isCompound,
    isScalar: raw.isScalar,
    isArray: raw.isArray,
    isGeomParam: raw.isGeomParam,
    metaData: raw.metaData,
  };
}

export type ScalarSampleInput =
  | number
  | bigint
  | boolean
  | string
  | readonly number[]
  | readonly bigint[]
  | readonly boolean[]
  | readonly string[]
  | NumericTypedArray;

export type ArraySampleInput =
  | NumericTypedArray
  | readonly number[]
  | readonly bigint[]
  | readonly boolean[]
  | readonly string[];

export function coerceNumericTypedArray(
  pod: PlainOldDataType,
  input: NumericTypedArray | readonly number[] | readonly bigint[]
): NumericTypedArray {
  switch (pod) {
    case PlainOldDataType.Uint8:
      return input instanceof Uint8Array ? input : Uint8Array.from(input as readonly number[]);
    case PlainOldDataType.Int8:
      return input instanceof Int8Array ? input : Int8Array.from(input as readonly number[]);
    case PlainOldDataType.Uint16:
      return input instanceof Uint16Array ? input : Uint16Array.from(input as readonly number[]);
    case PlainOldDataType.Int16:
      return input instanceof Int16Array ? input : Int16Array.from(input as readonly number[]);
    case PlainOldDataType.Uint32:
      return input instanceof Uint32Array ? input : Uint32Array.from(input as readonly number[]);
    case PlainOldDataType.Int32:
      return input instanceof Int32Array ? input : Int32Array.from(input as readonly number[]);
    case PlainOldDataType.Uint64:
      return input instanceof BigUint64Array
        ? input
        : BigUint64Array.from(Array.from(input as Iterable<number | bigint>, (v) => BigInt(v)));
    case PlainOldDataType.Int64:
      return input instanceof BigInt64Array
        ? input
        : BigInt64Array.from(Array.from(input as Iterable<number | bigint>, (v) => BigInt(v)));
    case PlainOldDataType.Float16:
      if (input instanceof Uint16Array) {
        return input;
      }
      return input instanceof Float32Array ? input : Float32Array.from(input as readonly number[]);
    case PlainOldDataType.Float32:
      return input instanceof Float32Array ? input : Float32Array.from(input as readonly number[]);
    case PlainOldDataType.Float64:
      return input instanceof Float64Array ? input : Float64Array.from(input as readonly number[]);
    default:
      throw new AlembicError(`POD ${pod} is not a numeric POD type.`);
  }
}

export class IScalarProperty implements Disposable {
  readonly handle: IScalarWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: IScalarWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get pod(): PlainOldDataType {
    return callWasm(this.mod, () => this.handle.getPod() as PlainOldDataType);
  }

  get extent(): number {
    return callWasm(this.mod, () => this.handle.getExtent());
  }

  get dataType(): DataType {
    return { pod: this.pod, extent: this.extent };
  }

  get interpretation(): string {
    return callWasm(this.mod, () => this.handle.getInterpretation());
  }

  get metaData(): Record<string, string> {
    return callWasm(this.mod, () => this.handle.getMetaData());
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

  /**
   * Returns the scalar sample as a TypedArray (numeric PODs, with Float16 auto-decoded to Float32Array),
   * `boolean[]` (Boolean POD), or `string[]` (String / Wstring POD).
   */
  getSample(selector?: SampleSelectorInput, options?: { copy?: boolean; rawFloat16?: boolean }): SampleArrayValue {
    const { mode, value } = resolveSampleSelector(selector);
    const pod = this.pod;
    const copy = options?.copy ?? true;

    if (
      pod === PlainOldDataType.Boolean ||
      pod === PlainOldDataType.String ||
      pod === PlainOldDataType.Wstring
    ) {
      return callWasm(this.mod, () => this.handle.getSpecialSample(mode, value)) as boolean[] | string[];
    }

    if (pod === PlainOldDataType.Float16 && !options?.rawFloat16) {
      const desc = callWasm(this.mod, () => this.handle.getFloat16AsFloat32Sample(mode, value));
      return readFloat32View(this.mod, desc, copy);
    }

    const desc = callWasm(this.mod, () => this.handle.getNumericSample(mode, value));
    return readNumericBufferView(this.mod, desc, copy);
  }

  /**
   * Convenience accessor: if `extent === 1`, unwraps the single scalar (`number | bigint | boolean | string`);
   * if `extent > 1`, returns the tuple array/TypedArray.
   */
  getValue(selector?: SampleSelectorInput): number | bigint | boolean | string | SampleArrayValue {
    const sample = this.getSample(selector, { copy: true });
    if (this.extent === 1 && sample.length === 1) {
      return sample[0]!;
    }
    return sample;
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

export class IArrayProperty implements Disposable {
  readonly handle: IArrayWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: IArrayWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get pod(): PlainOldDataType {
    return callWasm(this.mod, () => this.handle.getPod() as PlainOldDataType);
  }

  get extent(): number {
    return callWasm(this.mod, () => this.handle.getExtent());
  }

  get dataType(): DataType {
    return { pod: this.pod, extent: this.extent };
  }

  get interpretation(): string {
    return callWasm(this.mod, () => this.handle.getInterpretation());
  }

  get metaData(): Record<string, string> {
    return callWasm(this.mod, () => this.handle.getMetaData());
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

  getDimensions(selector?: SampleSelectorInput): number[] {
    const { mode, value } = resolveSampleSelector(selector);
    return callWasm(this.mod, () => this.handle.getDimensions(mode, value));
  }

  getSample(selector?: SampleSelectorInput, options?: { copy?: boolean; rawFloat16?: boolean }): SampleArrayValue {
    const { mode, value } = resolveSampleSelector(selector);
    const pod = this.pod;
    const copy = options?.copy ?? true;

    if (
      pod === PlainOldDataType.Boolean ||
      pod === PlainOldDataType.String ||
      pod === PlainOldDataType.Wstring
    ) {
      return callWasm(this.mod, () => this.handle.getSpecialSample(mode, value)) as boolean[] | string[];
    }

    if (pod === PlainOldDataType.Float16 && !options?.rawFloat16) {
      const desc = callWasm(this.mod, () => this.handle.getFloat16AsFloat32Sample(mode, value));
      return readFloat32View(this.mod, desc, copy);
    }

    const desc = callWasm(this.mod, () => this.handle.getNumericSample(mode, value));
    return readNumericBufferView(this.mod, desc, copy);
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

export class ICompoundProperty implements Disposable {
  readonly handle: ICompoundWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: ICompoundWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get metaData(): Record<string, string> {
    return callWasm(this.mod, () => this.handle.getMetaData());
  }

  get numProperties(): number {
    return callWasm(this.mod, () => this.handle.getNumProperties());
  }

  hasProperty(name: string): boolean {
    return callWasm(this.mod, () => this.handle.hasProperty(name));
  }

  getHeaders(): PropertyHeader[] {
    const count = this.numProperties;
    const out: PropertyHeader[] = [];
    for (let i = 0; i < count; i++) {
      const raw = callWasm(this.mod, () => this.handle.getPropertyHeaderInfo(i));
      out.push(toPropertyHeader(raw));
    }
    return out;
  }

  getHeader(name: string): PropertyHeader | null {
    const raw = callWasm(this.mod, () => this.handle.getPropertyHeaderByName(name));
    return raw ? toPropertyHeader(raw) : null;
  }

  getCompound(name: string): ICompoundProperty {
    const child = callWasm(this.mod, () => this.handle.getCompoundProperty(name));
    return new ICompoundProperty(child, this.mod);
  }

  getScalar(name: string): IScalarProperty {
    const child = callWasm(this.mod, () => this.handle.getScalarProperty(name));
    return new IScalarProperty(child, this.mod);
  }

  getArray(name: string): IArrayProperty {
    const child = callWasm(this.mod, () => this.handle.getArrayProperty(name));
    return new IArrayProperty(child, this.mod);
  }

  getGeomParam(name: string): IGeomParam {
    const gp = callWasm(this.mod, () => this.handle.getGeomParam(name));
    return new IGeomParam(gp, this.mod);
  }

  /**
   * Opens a child property by name, returning `ICompoundProperty | IScalarProperty | IArrayProperty | null`.
   */
  getProperty(name: string): ICompoundProperty | IScalarProperty | IArrayProperty | null {
    const hdr = this.getHeader(name);
    if (!hdr) {
      return null;
    }
    if (hdr.isCompound) {
      return this.getCompound(name);
    }
    if (hdr.isScalar) {
      return this.getScalar(name);
    }
    return this.getArray(name);
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

export class OScalarProperty implements Disposable {
  readonly handle: OScalarWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: OScalarWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get pod(): PlainOldDataType {
    return callWasm(this.mod, () => this.handle.getPod() as PlainOldDataType);
  }

  get extent(): number {
    return callWasm(this.mod, () => this.handle.getExtent());
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  setSample(value: ScalarSampleInput): void {
    const pod = this.pod;
    const extent = this.extent;

    if (pod === PlainOldDataType.Boolean) {
      const arr = Array.isArray(value)
        ? value.map((v) => Boolean(v))
        : value instanceof Uint8Array
          ? Array.from(value, (v) => v !== 0)
          : [Boolean(value)];
      if (arr.length !== extent) {
        throw new AlembicError(`Expected ${extent} boolean scalar element(s), got ${arr.length}.`);
      }
      callWasm(this.mod, () => this.handle.setSpecialSample(arr));
      return;
    }

    if (pod === PlainOldDataType.String || pod === PlainOldDataType.Wstring) {
      const arr = Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
      if (arr.length !== extent) {
        throw new AlembicError(`Expected ${extent} string scalar element(s), got ${arr.length}.`);
      }
      callWasm(this.mod, () => this.handle.setSpecialSample(arr));
      return;
    }

    const rawSeq =
      typeof value === "number" || typeof value === "bigint"
        ? ([value] as readonly number[] | readonly bigint[])
        : (value as NumericTypedArray | readonly number[] | readonly bigint[]);

    const typed = coerceNumericTypedArray(pod, rawSeq);
    if (typed.length !== extent) {
      throw new AlembicError(`Expected ${extent} scalar element(s) for ${this.name}, got ${typed.length}.`);
    }

    const arena = getAlembicArena();
    const ptr = arena.stageSingle(typed);

    if (pod === PlainOldDataType.Float16 && typed instanceof Float32Array) {
      callWasm(this.mod, () => this.handle.setFloat32AsFloat16Sample(ptr, extent));
    } else {
      const expectedBytes = extent * podByteSize(pod);
      callWasm(this.mod, () => this.handle.setNumericSample(ptr, expectedBytes));
    }
  }

  setFromPrevious(): void {
    callWasm(this.mod, () => this.handle.setFromPrevious());
  }

  setTimeSampling(timeSamplingIndex: number): void {
    callWasm(this.mod, () => this.handle.setTimeSampling(timeSamplingIndex));
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

export class OArrayProperty implements Disposable {
  readonly handle: OArrayWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: OArrayWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get pod(): PlainOldDataType {
    return callWasm(this.mod, () => this.handle.getPod() as PlainOldDataType);
  }

  get extent(): number {
    return callWasm(this.mod, () => this.handle.getExtent());
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  setSample(values: ArraySampleInput): void {
    const pod = this.pod;
    const extent = Math.max(1, this.extent);

    if (pod === PlainOldDataType.Boolean) {
      const arr =
        values instanceof Uint8Array
          ? Array.from(values, (v) => v !== 0)
          : Array.from(values as Iterable<boolean>, (v) => Boolean(v));
      if (arr.length % extent !== 0) {
        throw new AlembicError(
          `Array sample length (${arr.length}) must be divisible by extent (${extent}).`
        );
      }
      callWasm(this.mod, () => this.handle.setSpecialSample(arr));
      return;
    }

    if (pod === PlainOldDataType.String || pod === PlainOldDataType.Wstring) {
      const arr = Array.from(values as Iterable<string>, (v) => String(v));
      if (arr.length % extent !== 0) {
        throw new AlembicError(
          `Array sample length (${arr.length}) must be divisible by extent (${extent}).`
        );
      }
      callWasm(this.mod, () => this.handle.setSpecialSample(arr));
      return;
    }

    const typed = coerceNumericTypedArray(
      pod,
      values as NumericTypedArray | readonly number[] | readonly bigint[]
    );
    if (typed.length % extent !== 0) {
      throw new AlembicError(
        `Array sample scalar length (${typed.length}) must be divisible by extent (${extent}).`
      );
    }
    const tupleCount = typed.length / extent;
    const arena = getAlembicArena();
    const ptr = arena.stageSingle(typed);

    if (pod === PlainOldDataType.Float16 && typed instanceof Float32Array) {
      callWasm(this.mod, () => this.handle.setFloat32AsFloat16Sample(ptr, tupleCount));
    } else {
      callWasm(this.mod, () => this.handle.setNumericSample(ptr, tupleCount));
    }
  }

  setFromPrevious(): void {
    callWasm(this.mod, () => this.handle.setFromPrevious());
  }

  setTimeSampling(timeSamplingIndex: number): void {
    callWasm(this.mod, () => this.handle.setTimeSampling(timeSamplingIndex));
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

export interface CreatePropertyOptions {
  extent?: number;
  interpretation?: string;
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export interface CreateGeomParamOptions {
  pod: PlainOldDataType;
  extent?: number;
  arrayExtent?: number;
  interpretation?: string;
  isIndexed?: boolean;
  scope?: GeometryScope;
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class OCompoundProperty implements Disposable {
  readonly handle: OCompoundWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: OCompoundWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get metaData(): Record<string, string> {
    return callWasm(this.mod, () => this.handle.getMetaData());
  }

  createCompound(name: string, metaData?: MetaDataMap): OCompoundProperty {
    const child = callWasm(this.mod, () =>
      this.handle.createCompoundProperty(name, normalizeMetaData(metaData))
    );
    return new OCompoundProperty(child, this.mod);
  }

  createScalar(
    name: string,
    pod: PlainOldDataType,
    options?: CreatePropertyOptions
  ): OScalarProperty {
    const extent = options?.extent ?? 1;
    const interpretation = options?.interpretation ?? "";
    const tsIndex = options?.timeSamplingIndex ?? 0;
    const meta = normalizeMetaData(options?.metaData);
    const child = callWasm(this.mod, () =>
      this.handle.createScalarProperty(name, pod, extent, interpretation, tsIndex, meta)
    );
    return new OScalarProperty(child, this.mod);
  }

  createArray(
    name: string,
    pod: PlainOldDataType,
    options?: CreatePropertyOptions
  ): OArrayProperty {
    const extent = options?.extent ?? 1;
    const interpretation = options?.interpretation ?? "";
    const tsIndex = options?.timeSamplingIndex ?? 0;
    const meta = normalizeMetaData(options?.metaData);
    const child = callWasm(this.mod, () =>
      this.handle.createArrayProperty(name, pod, extent, interpretation, tsIndex, meta)
    );
    return new OArrayProperty(child, this.mod);
  }

  createGeomParam(name: string, options: CreateGeomParamOptions): OGeomParam {
    const gp = callWasm(this.mod, () =>
      this.handle.createGeomParam(
        name,
        options.pod,
        options.extent ?? 1,
        options.arrayExtent ?? 1,
        options.interpretation ?? "",
        options.isIndexed ?? false,
        options.scope ?? GeometryScope.Vertex,
        options.timeSamplingIndex ?? 0,
        normalizeMetaData(options.metaData)
      )
    );
    return new OGeomParam(gp, this.mod);
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
