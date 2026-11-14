import type {
  AlembicWasmModule,
  ArchiveReaderContext,
  ArchiveWriterContext,
  IArchiveWrap,
} from "../wasm/bindings.js";
import { readUint8View } from "../wasm/arena.js";
import {
  getAlembicArena,
  getAlembicModule,
  initAlembic,
  type InitAlembicOptions,
} from "../wasm/loader.js";
import { AlembicError, ArchiveClosedError, callWasm } from "./errors.js";
import { normalizeMetaData, type MetaDataMap } from "./metadata.js";
import { IObject, OObject } from "./object.js";
import {
  TimeSampling,
  resolveSampleSelector,
  type SampleSelectorInput,
} from "./timeSampling.js";
import {
  fromBox3dDesc,
  toBox3dDesc,
  type ArchiveInfo,
  type Box3d,
} from "./types.js";

export type ArchiveSource =
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | Response
  | URL
  | string;

const readerCleanupRegistry =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<IArchiveWrap>((handle) => {
        try {
          if (!handle.isDeleted()) {
            handle.close();
            handle.delete();
          }
        } catch {
          // Ignore finalizer cleanup errors
        }
      })
    : null;

const writerCleanupRegistry =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<ArchiveWriterContext>((handle) => {
        try {
          if (!handle.isDeleted()) {
            handle.dispose();
            handle.delete();
          }
        } catch {
          // Ignore finalizer cleanup errors
        }
      })
    : null;

function isNodeRuntime(): boolean {
  return (
    typeof globalThis.process !== "undefined" &&
    Boolean(globalThis.process?.versions?.node) &&
    (globalThis.process as { type?: string }).type !== "renderer"
  );
}

async function resolveSourceBytes(source: ArchiveSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  if (typeof Response !== "undefined" && source instanceof Response) {
    if (!source.ok) {
      throw new AlembicError(`HTTP ${source.status} while reading Alembic Response.`);
    }
    return new Uint8Array(await source.arrayBuffer());
  }

  const strOrUrl = source instanceof URL ? source : String(source);
  const href = typeof strOrUrl === "string" ? strOrUrl : strOrUrl.href;

  if (
    isNodeRuntime() &&
    !(href.startsWith("http://") || href.startsWith("https://") || href.startsWith("blob:") || href.startsWith("data:"))
  ) {
    const fsModuleId = "node:" + "fs/promises";
    const fs = (await import(/* @vite-ignore */ fsModuleId)) as typeof import("node:fs/promises");
    const filePath = href.startsWith("file:") ? new URL(href) : href;
    const buf = await fs.readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  const response = await fetch(href);
  if (!response.ok) {
    throw new AlembicError(`Failed to fetch Alembic archive "${href}" (HTTP ${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function populateReaderContext(mod: AlembicWasmModule, bytes: Uint8Array): ArchiveReaderContext {
  const ctx = callWasm(mod, () => mod.createReaderBuffer(bytes.byteLength));
  try {
    if (bytes.byteLength > 0) {
      const dstPtr = ctx.dataPtr() >>> 0;
      mod.HEAPU8.set(bytes, dstPtr);
    }
    return ctx;
  } catch (err) {
    ctx.delete();
    throw err;
  }
}

export class IArchive implements Disposable {
  readonly handle: IArchiveWrap;
  private readonly mod: AlembicWasmModule;
  private topCache: IObject | null = null;

  constructor(handle: IArchiveWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
    readerCleanupRegistry?.register(this, handle, this);
  }

  get isClosed(): boolean {
    return this.handle.isDeleted() || this.handle.isClosed();
  }

  private ensureOpen(): void {
    if (this.isClosed) {
      throw new ArchiveClosedError();
    }
  }

  get coreType(): string {
    this.ensureOpen();
    return callWasm(this.mod, () => this.handle.getCoreType());
  }

  get info(): ArchiveInfo {
    this.ensureOpen();
    return callWasm(this.mod, () => this.handle.getInfo());
  }

  get top(): IObject {
    this.ensureOpen();
    if (!this.topCache || this.topCache.handle.isDeleted()) {
      const wrap = callWasm(this.mod, () => this.mod.getArchiveTopObject(this.handle));
      this.topCache = new IObject(wrap, this.mod);
    }
    return this.topCache;
  }

  get numTimeSamplings(): number {
    this.ensureOpen();
    return callWasm(this.mod, () => this.handle.getNumTimeSamplings());
  }

  getTimeSampling(index: number): TimeSampling {
    this.ensureOpen();
    const raw = callWasm(this.mod, () => this.handle.getTimeSamplingInfo(index));
    return TimeSampling.fromRaw(raw);
  }

  getTimeSamplings(): TimeSampling[] {
    const count = this.numTimeSamplings;
    const out: TimeSampling[] = [];
    for (let i = 0; i < count; i++) {
      out.push(this.getTimeSampling(i));
    }
    return out;
  }

  getArchiveBounds(selector?: SampleSelectorInput): Box3d | null {
    this.ensureOpen();
    const { mode, value } = resolveSampleSelector(selector);
    return fromBox3dDesc(callWasm(this.mod, () => this.handle.getArchiveBounds(mode, value)));
  }

  findObject(path: string): IObject | null {
    this.ensureOpen();
    return this.top.findByPath(path);
  }

  /**
   * Produces a full human-readable hierarchical dump of objects, schemas, metadata, and properties.
   */
  echo(): string {
    this.ensureOpen();
    return callWasm(this.mod, () => this.handle.echo());
  }

  close(): void {
    readerCleanupRegistry?.unregister(this);
    if (this.topCache) {
      this.topCache.dispose();
      this.topCache = null;
    }
    if (!this.handle.isDeleted()) {
      this.handle.close();
      this.handle.delete();
    }
  }

  dispose(): void {
    this.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

export interface CreateArchiveOptions extends InitAlembicOptions {
  appName?: string;
  userDescription?: string;
  dccFps?: number;
  metaData?: MetaDataMap;
}

export class OArchive implements Disposable {
  readonly handle: ArchiveWriterContext;
  private readonly mod: AlembicWasmModule;
  private topCache: OObject | null = null;
  private finalizedBytes: Uint8Array | null = null;

  constructor(handle: ArchiveWriterContext, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
    writerCleanupRegistry?.register(this, handle, this);
  }

  get isFinalized(): boolean {
    return this.finalizedBytes !== null || this.handle.isDeleted() || this.handle.isFinalized();
  }

  private ensureWritable(): void {
    if (this.isFinalized) {
      throw new ArchiveClosedError("OArchive has already been finalized or closed.");
    }
  }

  get top(): OObject {
    this.ensureWritable();
    if (!this.topCache || this.topCache.handle.isDeleted()) {
      const wrap = callWasm(this.mod, () => this.mod.getWriterTopObject(this.handle));
      this.topCache = new OObject(wrap, this.mod);
    }
    return this.topCache;
  }

  addTimeSampling(timeSampling: TimeSampling): number {
    this.ensureWritable();
    const kindCode =
      timeSampling.kind === "uniform" ? 0 : timeSampling.kind === "cyclic" ? 1 : 2;
    const f64 = Float64Array.from(timeSampling.storedTimes);
    const ptr = getAlembicArena().stageSingle(f64);
    return callWasm(this.mod, () =>
      this.handle.addTimeSampling(kindCode, timeSampling.timePerCycle, ptr, f64.length)
    );
  }

  addUniformTimeSampling(fpsOrTimePerCycle = 24, options?: { isFps?: boolean; startTime?: number }): number {
    const isFps = options?.isFps ?? fpsOrTimePerCycle > 1;
    const dt = isFps ? 1 / fpsOrTimePerCycle : fpsOrTimePerCycle;
    return this.addTimeSampling(TimeSampling.uniform(dt, options?.startTime ?? 0));
  }

  setArchiveBounds(bounds: Box3d, timeSamplingIndex = 0): void {
    this.ensureWritable();
    callWasm(this.mod, () =>
      this.handle.setArchiveBounds(toBox3dDesc(bounds), timeSamplingIndex)
    );
  }

  /**
   * Flushes all open writer objects/schemas/properties in reverse creation order, writes the Ogawa
   * archive footer, and returns a standalone owned `Uint8Array` containing the `.abc` binary.
   * Subsequent calls return the cached `Uint8Array`.
   */
  finalize(): Uint8Array {
    if (this.finalizedBytes) {
      return this.finalizedBytes;
    }
    if (this.handle.isDeleted()) {
      throw new ArchiveClosedError();
    }
    const desc = callWasm(this.mod, () => this.handle.finalize());
    const bytes = readUint8View(this.mod, desc, true);
    this.finalizedBytes = bytes;
    this.dispose();
    return bytes;
  }

  dispose(): void {
    writerCleanupRegistry?.unregister(this);
    if (this.topCache) {
      this.topCache.dispose();
      this.topCache = null;
    }
    if (!this.handle.isDeleted()) {
      this.handle.dispose();
      this.handle.delete();
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/**
 * Opens an Ogawa `.abc` archive from a `Uint8Array`, `ArrayBuffer`, `Blob`, `Response`, `URL`, or path/URL `string`.
 * Automatically initializes the WASM module if needed.
 */
export async function openArchive(
  source: ArchiveSource,
  options?: InitAlembicOptions
): Promise<IArchive> {
  const [mod, bytes] = await Promise.all([initAlembic(options), resolveSourceBytes(source)]);
  const ctx = populateReaderContext(mod, bytes);
  try {
    const archiveWrap = callWasm(mod, () => mod.openReaderArchive(ctx));
    return new IArchive(archiveWrap, mod);
  } finally {
    ctx.delete();
  }
}

/**
 * Opens an Ogawa `.abc` archive synchronously from in-memory bytes.
 * Requires `await initAlembic()` to have completed beforehand.
 */
export function openArchiveSync(bytes: Uint8Array | ArrayBuffer | ArrayBufferView): IArchive {
  const mod = getAlembicModule();
  const u8 =
    bytes instanceof Uint8Array
      ? bytes
      : bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ctx = populateReaderContext(mod, u8);
  try {
    const archiveWrap = callWasm(mod, () => mod.openReaderArchive(ctx));
    return new IArchive(archiveWrap, mod);
  } finally {
    ctx.delete();
  }
}

/**
 * Opens multiple `.abc` layers as a single composite `IArchive` via `Alembic::AbcCoreLayer`
 * (`layers[0]` is the base layer, subsequent entries override/prune/replace earlier layers).
 */
export async function openLayeredArchive(
  layers: readonly ArchiveSource[],
  options?: InitAlembicOptions
): Promise<IArchive> {
  if (layers.length === 0) {
    throw new AlembicError("openLayeredArchive requires at least one layer source.");
  }
  const mod = await initAlembic(options);
  const byteArrays = await Promise.all(layers.map((src) => resolveSourceBytes(src)));
  const ctxs: ArchiveReaderContext[] = [];
  try {
    for (const bytes of byteArrays) {
      const ctx = populateReaderContext(mod, bytes);
      ctxs.push(ctx);
      callWasm(mod, () => ctx.open());
    }
    const mergedWrap = callWasm(mod, () => mod.openLayeredReaderArchive(ctxs));
    return new IArchive(mergedWrap, mod);
  } finally {
    for (const ctx of ctxs) {
      if (!ctx.isDeleted()) {
        ctx.delete();
      }
    }
  }
}

/**
 * Creates a new in-memory Ogawa `OArchive` writer (auto-initializing WASM if needed).
 */
export async function createArchive(options?: CreateArchiveOptions): Promise<OArchive> {
  const mod = await initAlembic(options);
  return createArchiveSync(options, mod);
}

/**
 * Creates a new in-memory Ogawa `OArchive` writer synchronously (requires `await initAlembic()`).
 */
export function createArchiveSync(
  options?: Omit<CreateArchiveOptions, keyof InitAlembicOptions>,
  mod = getAlembicModule()
): OArchive {
  const appName = options?.appName ?? "alembic-wasm";
  const userDescription = options?.userDescription ?? "";
  const dccFps = options?.dccFps ?? 24;
  const meta = normalizeMetaData(options?.metaData);
  const ctx = callWasm(mod, () => mod.createWriterArchive(appName, userDescription, dccFps, meta));
  return new OArchive(ctx, mod);
}

export function getLibraryVersion(): string {
  const mod = getAlembicModule();
  return callWasm(mod, () => mod.getAlembicLibraryVersion());
}

export function getLibraryVersionShort(): string {
  const mod = getAlembicModule();
  return callWasm(mod, () => mod.getAlembicLibraryVersionShort());
}
