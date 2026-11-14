import type {
  AlembicWasmModule,
  GenericIGeomParam,
  GenericOGeomParam,
} from "../wasm/bindings.js";
import { readNumericBufferView } from "../wasm/arena.js";
import { getAlembicArena, getAlembicModule } from "../wasm/loader.js";
import { AlembicError, callWasm } from "./errors.js";
import { resolveSampleSelector, type SampleSelectorInput } from "./timeSampling.js";
import {
  GeometryScope,
  PlainOldDataType,
  type DataType,
  type NumericTypedArray,
  type SampleArrayValue,
} from "./types.js";
import {
  IArrayProperty,
  coerceNumericTypedArray,
  type ArraySampleInput,
} from "./properties.js";

export interface IndexedGeomParamSample {
  values: SampleArrayValue;
  indices: Uint32Array | null;
  scope: GeometryScope;
}

export class IGeomParam implements Disposable {
  readonly handle: GenericIGeomParam;
  private readonly mod: AlembicWasmModule;

  constructor(handle: GenericIGeomParam, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get isIndexed(): boolean {
    return callWasm(this.mod, () => this.handle.isIndexed());
  }

  get scope(): GeometryScope {
    return callWasm(this.mod, () => this.handle.getScope() as GeometryScope);
  }

  get pod(): PlainOldDataType {
    return callWasm(this.mod, () => this.handle.getPod() as PlainOldDataType);
  }

  get extent(): number {
    return callWasm(this.mod, () => this.handle.getExtent());
  }

  get arrayExtent(): number {
    return callWasm(this.mod, () => this.handle.getArrayExtent());
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

  getValueProperty(): IArrayProperty {
    const valWrap = callWasm(this.mod, () => this.handle.getValueProperty());
    return new IArrayProperty(valWrap, this.mod);
  }

  getIndexProperty(): IArrayProperty | null {
    const idxWrap = callWasm(this.mod, () => this.handle.getIndexProperty());
    return idxWrap ? new IArrayProperty(idxWrap, this.mod) : null;
  }

  getIndexedSample(selector?: SampleSelectorInput): IndexedGeomParamSample {
    const valProp = this.getValueProperty();
    try {
      const values = valProp.getSample(selector, { copy: true });
      const idxProp = this.getIndexProperty();
      let indices: Uint32Array | null = null;
      if (idxProp) {
        try {
          indices = idxProp.getSample(selector, { copy: true }) as Uint32Array;
        } finally {
          idxProp.dispose();
        }
      }
      return {
        values,
        indices,
        scope: this.scope,
      };
    } finally {
      valProp.dispose();
    }
  }

  /**
   * Returns the expanded (de-indexed) sample values for any POD type and `GeometryScope`.
   */
  getExpandedSample(selector?: SampleSelectorInput): SampleArrayValue {
    const pod = this.pod;
    const extent = Math.max(1, this.extent);

    if (
      pod === PlainOldDataType.Boolean ||
      pod === PlainOldDataType.String ||
      pod === PlainOldDataType.Wstring ||
      pod === PlainOldDataType.Float16
    ) {
      const { values, indices } = this.getIndexedSample(selector);
      if (!indices) {
        return values;
      }
      if (pod === PlainOldDataType.Float16) {
        const src = values as Float32Array;
        const out = new Float32Array(indices.length * extent);
        const tupleCount = Math.floor(src.length / extent);
        for (let i = 0; i < indices.length; i++) {
          const idx = indices[i]!;
          if (idx < tupleCount) {
            const srcBase = idx * extent;
            const dstBase = i * extent;
            for (let c = 0; c < extent; c++) {
              out[dstBase + c] = src[srcBase + c]!;
            }
          }
        }
        return out;
      }
      const srcArr = values as Array<boolean | string>;
      const tupleCount = Math.floor(srcArr.length / extent);
      const out: Array<boolean | string> = new Array(indices.length * extent);
      const fallback = pod === PlainOldDataType.Boolean ? false : "";
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i]!;
        for (let c = 0; c < extent; c++) {
          out[i * extent + c] = idx < tupleCount ? srcArr[idx * extent + c]! : fallback;
        }
      }
      return out as boolean[] | string[];
    }

    const { mode, value } = resolveSampleSelector(selector);
    const desc = callWasm(this.mod, () => this.handle.getExpandedNumericSample(mode, value));
    return readNumericBufferView(this.mod, desc, true);
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

export class OGeomParam implements Disposable {
  readonly handle: GenericOGeomParam;
  private readonly mod: AlembicWasmModule;

  constructor(handle: GenericOGeomParam, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get isIndexed(): boolean {
    return callWasm(this.mod, () => this.handle.isIndexed());
  }

  get scope(): GeometryScope {
    return callWasm(this.mod, () => this.handle.getScope() as GeometryScope);
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

  setSample(
    values: ArraySampleInput,
    indices?: Uint32Array | readonly number[] | null
  ): void {
    const pod = this.pod;
    const extent = Math.max(1, this.extent);
    const indexed = this.isIndexed;

    let idxView: Uint32Array | null = null;
    if (indexed) {
      if (!indices) {
        throw new AlembicError(`Indexed OGeomParam "${this.name}" requires an indices array.`);
      }
      idxView = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
    }

    const arena = getAlembicArena();

    if (
      pod === PlainOldDataType.Boolean ||
      pod === PlainOldDataType.String ||
      pod === PlainOldDataType.Wstring
    ) {
      const jsArr =
        pod === PlainOldDataType.Boolean
          ? Array.from(values as Iterable<boolean>, (v) => Boolean(v))
          : Array.from(values as Iterable<string>, (v) => String(v));
      if (jsArr.length % extent !== 0) {
        throw new AlembicError(
          `GeomParam "${this.name}" values length (${jsArr.length}) must be divisible by extent (${extent}).`
        );
      }
      const idxPtr = idxView ? arena.stageSingle(idxView) : 0;
      const idxCount = idxView ? idxView.length : 0;
      callWasm(this.mod, () => this.handle.setSpecialSample(jsArr, idxPtr, idxCount));
      return;
    }

    const valView =
      pod === PlainOldDataType.Float16
        ? values instanceof Float32Array
          ? values
          : Float32Array.from(values as readonly number[])
        : coerceNumericTypedArray(
            pod,
            values as NumericTypedArray | readonly number[] | readonly bigint[]
          );

    if (valView.length % extent !== 0) {
      throw new AlembicError(
        `GeomParam "${this.name}" scalar length (${valView.length}) must be divisible by extent (${extent}).`
      );
    }

    const tupleCount = valView.length / extent;
    const [valsPtr, idxPtr] = arena.stageViews([valView, idxView]);
    callWasm(this.mod, () =>
      this.handle.setNumericSample(valsPtr!, tupleCount, idxPtr!, idxView ? idxView.length : 0)
    );
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
