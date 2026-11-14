import type { AlembicWasmModule, BufferViewDesc } from "./bindings.js";
import { AlembicError } from "../core/errors.js";
import { PlainOldDataType, type NumericTypedArray } from "../core/types.js";

/**
 * Reusable bump-pointer arena in WASM linear memory for passing multiple typed arrays
 * to C++ writer methods in a single frame without malloc/free churn.
 *
 * Important: When growing an allocation, WASM linear memory may grow (`ALLOW_MEMORY_GROWTH=1`),
 * invalidating previous `ArrayBuffer` views. Always allocate all buffers for a single C++ call
 * via `withScope()` or copy data right after `alloc()`, or use `stageMultiple()` which reserves
 * total capacity up front before writing bytes!
 */
export class WasmScratchArena {
  private readonly module: AlembicWasmModule;
  private basePtr = 0;
  private capacity = 0;
  private offset = 0;

  constructor(module: AlembicWasmModule, initialCapacity = 64 * 1024) {
    this.module = module;
    if (initialCapacity > 0) {
      this.ensureTotalCapacity(initialCapacity);
    }
  }

  reset(): void {
    this.offset = 0;
  }

  dispose(): void {
    if (this.basePtr !== 0) {
      this.module._free(this.basePtr);
      this.basePtr = 0;
      this.capacity = 0;
      this.offset = 0;
    }
  }

  /**
   * Reserves enough total space for all byte lengths in `views` up front (so at most one
   * `_malloc` / memory growth occurs), copies every view into 8-byte aligned regions, and
   * returns their WASM byte pointers in matching order.
   */
  stageViews(views: ReadonlyArray<ArrayBufferView | null | undefined>): number[] {
    this.reset();
    let needed = 0;
    for (const v of views) {
      if (v && v.byteLength > 0) {
        needed = align8(needed) + v.byteLength;
      }
    }
    if (needed === 0) {
      return views.map(() => 0);
    }
    this.ensureTotalCapacity(needed);

    const heapU8 = this.module.HEAPU8;
    const ptrs: number[] = new Array(views.length);
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      if (!v || v.byteLength === 0) {
        ptrs[i] = 0;
        continue;
      }
      this.offset = align8(this.offset);
      const dstPtr = this.basePtr + this.offset;
      const srcBytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      heapU8.set(srcBytes, dstPtr);
      this.offset += v.byteLength;
      ptrs[i] = dstPtr;
    }
    return ptrs;
  }

  stageSingle(view: ArrayBufferView | null | undefined): number {
    if (!view || view.byteLength === 0) {
      return 0;
    }
    return this.stageViews([view])[0];
  }

  private ensureTotalCapacity(minBytes: number): void {
    const aligned = align8(minBytes);
    if (aligned <= this.capacity && this.basePtr !== 0) {
      return;
    }
    let nextCap = Math.max(this.capacity * 2, 64 * 1024);
    while (nextCap < aligned) {
      nextCap *= 2;
    }
    if (this.basePtr !== 0) {
      this.module._free(this.basePtr);
      this.basePtr = 0;
      this.capacity = 0;
    }
    const ptr = this.module._malloc(nextCap);
    if (!ptr) {
      throw new AlembicError(`Failed to allocate ${nextCap} bytes in WASM scratch arena.`);
    }
    this.basePtr = ptr;
    this.capacity = nextCap;
    this.offset = 0;
  }
}

function align8(n: number): number {
  return (n + 7) & ~7;
}

/**
 * Constructs a JS TypedArray from a C++ `BufferViewDesc`.
 * When `copy` is true (default, safe across subsequent WASM allocations/growth),
 * returns an owned TypedArray copy. When `copy` is false, returns a zero-copy live view
 * into WASM memory valid until the next WASM allocation or sample read on the same property.
 */
export function readNumericBufferView(
  module: AlembicWasmModule,
  desc: BufferViewDesc,
  copy = true
): NumericTypedArray {
  const scalarCount = desc.length * Math.max(1, desc.extent);
  const buf = module.HEAPU8.buffer;
  const ptr = desc.ptr >>> 0;

  if (scalarCount === 0 || ptr === 0) {
    return emptyTypedArrayForPod(desc.pod as PlainOldDataType);
  }

  const view = createLiveView(buf, ptr, scalarCount, desc.pod as PlainOldDataType);
  return copy ? (view.slice() as NumericTypedArray) : view;
}

export function readFloat32View(
  module: AlembicWasmModule,
  desc: BufferViewDesc,
  copy = true
): Float32Array {
  const scalarCount = desc.length * Math.max(1, desc.extent);
  const ptr = desc.ptr >>> 0;
  if (scalarCount === 0 || ptr === 0) {
    return new Float32Array(0);
  }
  const view = new Float32Array(module.HEAPU8.buffer, ptr, scalarCount);
  return copy ? view.slice() : view;
}

export function readFloat64View(
  module: AlembicWasmModule,
  desc: BufferViewDesc,
  copy = true
): Float64Array {
  const scalarCount = desc.length * Math.max(1, desc.extent);
  const ptr = desc.ptr >>> 0;
  if (scalarCount === 0 || ptr === 0) {
    return new Float64Array(0);
  }
  const view = new Float64Array(module.HEAPU8.buffer, ptr, scalarCount);
  return copy ? view.slice() : view;
}

export function readInt32View(
  module: AlembicWasmModule,
  desc: BufferViewDesc,
  copy = true
): Int32Array {
  const scalarCount = desc.length * Math.max(1, desc.extent);
  const ptr = desc.ptr >>> 0;
  if (scalarCount === 0 || ptr === 0) {
    return new Int32Array(0);
  }
  const view = new Int32Array(module.HEAPU8.buffer, ptr, scalarCount);
  return copy ? view.slice() : view;
}

export function readUint32View(
  module: AlembicWasmModule,
  desc: BufferViewDesc,
  copy = true
): Uint32Array {
  const scalarCount = desc.length * Math.max(1, desc.extent);
  const ptr = desc.ptr >>> 0;
  if (scalarCount === 0 || ptr === 0) {
    return new Uint32Array(0);
  }
  const view = new Uint32Array(module.HEAPU8.buffer, ptr, scalarCount);
  return copy ? view.slice() : view;
}

export function readBigUint64View(
  module: AlembicWasmModule,
  desc: BufferViewDesc,
  copy = true
): BigUint64Array {
  const scalarCount = desc.length * Math.max(1, desc.extent);
  const ptr = desc.ptr >>> 0;
  if (scalarCount === 0 || ptr === 0) {
    return new BigUint64Array(0);
  }
  const view = new BigUint64Array(module.HEAPU8.buffer, ptr, scalarCount);
  return copy ? view.slice() : view;
}

export function readUint8View(
  module: AlembicWasmModule,
  desc: BufferViewDesc,
  copy = true
): Uint8Array {
  const byteLen = desc.byteLength || desc.length * Math.max(1, desc.extent);
  const ptr = desc.ptr >>> 0;
  if (byteLen === 0 || ptr === 0) {
    return new Uint8Array(0);
  }
  const view = new Uint8Array(module.HEAPU8.buffer, ptr, byteLen);
  return copy ? view.slice() : view;
}

function emptyTypedArrayForPod(pod: PlainOldDataType): NumericTypedArray {
  switch (pod) {
    case PlainOldDataType.Uint8:
      return new Uint8Array(0);
    case PlainOldDataType.Int8:
      return new Int8Array(0);
    case PlainOldDataType.Uint16:
    case PlainOldDataType.Float16:
      return new Uint16Array(0);
    case PlainOldDataType.Int16:
      return new Int16Array(0);
    case PlainOldDataType.Uint32:
      return new Uint32Array(0);
    case PlainOldDataType.Int32:
      return new Int32Array(0);
    case PlainOldDataType.Uint64:
      return new BigUint64Array(0);
    case PlainOldDataType.Int64:
      return new BigInt64Array(0);
    case PlainOldDataType.Float32:
      return new Float32Array(0);
    case PlainOldDataType.Float64:
      return new Float64Array(0);
    default:
      return new Uint8Array(0);
  }
}

function createLiveView(
  buffer: ArrayBufferLike,
  byteOffset: number,
  scalarCount: number,
  pod: PlainOldDataType
): NumericTypedArray {
  switch (pod) {
    case PlainOldDataType.Uint8:
      return new Uint8Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Int8:
      return new Int8Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Uint16:
    case PlainOldDataType.Float16:
      return new Uint16Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Int16:
      return new Int16Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Uint32:
      return new Uint32Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Int32:
      return new Int32Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Uint64:
      return new BigUint64Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Int64:
      return new BigInt64Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Float32:
      return new Float32Array(buffer, byteOffset, scalarCount);
    case PlainOldDataType.Float64:
      return new Float64Array(buffer, byteOffset, scalarCount);
    default:
      throw new AlembicError(`Unsupported numeric POD code: ${pod}`);
  }
}
