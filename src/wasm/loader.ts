import type {
  AlembicWasmModule,
  CreateAlembicModuleFactory,
  CreateAlembicModuleOptions,
} from "./bindings.js";
import { WasmScratchArena } from "./arena.js";
import { AlembicError } from "../core/errors.js";
// @ts-expect-error Generated Emscripten ES module glue
import createAlembicModuleUntyped from "./generated/alembic_wasm.js";

const createAlembicModule = createAlembicModuleUntyped as CreateAlembicModuleFactory;

export interface InitAlembicOptions {
  /**
   * Custom URL or path to `alembic_wasm.wasm` (useful when hosting static assets on a CDN).
   */
  wasmUrl?: string | URL;
  /**
   * Pre-loaded `alembic_wasm.wasm` binary buffer.
   */
  wasmBinary?: ArrayBuffer | Uint8Array;
}

let moduleInstance: AlembicWasmModule | null = null;
let arenaInstance: WasmScratchArena | null = null;
let initPromise: Promise<AlembicWasmModule> | null = null;

/**
 * Initializes (or returns the already initialized) `alembic-wasm` WebAssembly module.
 * Safe to call concurrently from multiple callers; initialization runs once.
 */
export async function initAlembic(options?: InitAlembicOptions): Promise<AlembicWasmModule> {
  if (moduleInstance && !options?.wasmBinary && !options?.wasmUrl) {
    return moduleInstance;
  }
  if (initPromise && !options?.wasmBinary && !options?.wasmUrl) {
    return initPromise;
  }

  initPromise = (async () => {
    const createOpts: CreateAlembicModuleOptions = {};

    if (options?.wasmBinary) {
      createOpts.wasmBinary = options.wasmBinary;
    } else if (options?.wasmUrl) {
      const resolvedUrl = String(options.wasmUrl);
      createOpts.locateFile = (path: string) =>
        path.endsWith(".wasm") ? resolvedUrl : path;
    }
    // When neither wasmBinary nor wasmUrl is passed, Emscripten's generated ES module
    // automatically resolves its sibling `alembic_wasm.wasm` via `new URL("alembic_wasm.wasm", import.meta.url)`
    // across Node.js, Browsers, Web Workers, and Bundlers without base64-duplicating the binary.

    const mod = await createAlembicModule(createOpts);
    // Hide multi-megabyte Emscripten heap views from enumerable property walks
    // (e.g. console.log, JSON.stringify, Vitest diff formatters) while keeping them writable
    // for Emscripten's updateMemoryViews() on WASM memory growth.
    for (const key of [
      "HEAP8",
      "HEAPU8",
      "HEAP16",
      "HEAPU16",
      "HEAP32",
      "HEAPU32",
      "HEAPF32",
      "HEAPF64",
      "HEAP64",
      "HEAPU64",
      "wasmMemory",
      "asm",
    ]) {
      if (key in mod) {
        Object.defineProperty(mod, key, {
          value: (mod as unknown as Record<string, unknown>)[key],
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }
    }
    moduleInstance = mod;
    if (!arenaInstance) {
      arenaInstance = new WasmScratchArena(mod);
    }
    return mod;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err instanceof Error
      ? new AlembicError(`Failed to initialize alembic-wasm: ${err.message}`, undefined, { cause: err })
      : new AlembicError(`Failed to initialize alembic-wasm: ${String(err)}`);
  }
}

export function isAlembicInitialized(): boolean {
  return moduleInstance !== null;
}

export function getAlembicModule(): AlembicWasmModule {
  if (!moduleInstance) {
    throw new AlembicError(
      "alembic-wasm has not been initialized yet. Call `await initAlembic()` or `await openArchive(...)` first."
    );
  }
  return moduleInstance;
}

export function getAlembicArena(): WasmScratchArena {
  if (!arenaInstance) {
    const mod = getAlembicModule();
    arenaInstance = new WasmScratchArena(mod);
  }
  return arenaInstance;
}
