import type { AlembicWasmModule } from "../wasm/bindings.js";

// Ensure Symbol.dispose exists in runtimes that have not shipped Explicit Resource Management natively yet
if (typeof (Symbol as { dispose?: symbol }).dispose === "undefined") {
  Object.defineProperty(Symbol, "dispose", {
    value: Symbol.for("Symbol.dispose"),
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

export class AlembicError extends Error {
  readonly cppType?: string;

  constructor(message: string, cppType?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AlembicError";
    this.cppType = cppType;
  }
}

export class ArchiveClosedError extends AlembicError {
  constructor(message = "Alembic archive has already been closed or finalized.") {
    super(message);
    this.name = "ArchiveClosedError";
  }
}

export class UnsupportedCoreTypeError extends AlembicError {
  readonly coreType: string;

  constructor(message: string, coreType = "HDF5") {
    super(message);
    this.name = "UnsupportedCoreTypeError";
    this.coreType = coreType;
  }
}

export function decodeWasmException(module: AlembicWasmModule | null, err: unknown): Error {
  if (err instanceof AlembicError) {
    return err;
  }
  if (module) {
    try {
      if (typeof module.getExceptionMessage === "function" && err && typeof err === "object") {
        const [cppType, msg] = module.getExceptionMessage(err);
        if (msg) {
          return classifyCppMessage(msg, cppType, err);
        }
      }
      if (
        err &&
        typeof err === "object" &&
        "excPtr" in err &&
        typeof (err as { excPtr: unknown }).excPtr === "number"
      ) {
        const msg = module.getCppExceptionMessage((err as { excPtr: number }).excPtr);
        return classifyCppMessage(msg, "std::exception", err);
      }
      if (typeof err === "number") {
        const msg = module.getCppExceptionMessage(err);
        return classifyCppMessage(msg, "std::exception", err);
      }
    } catch {
      // Fall through to generic wrapping
    }
  }
  if (err instanceof Error) {
    return classifyCppMessage(err.message, undefined, err);
  }
  return new AlembicError(String(err));
}

function classifyCppMessage(msg: string, cppType?: string, cause?: unknown): AlembicError {
  if (
    msg.includes("Archive has been closed") ||
    msg.includes("finalized/closed") ||
    msg.includes("finalized or disposed")
  ) {
    return new ArchiveClosedError(msg);
  }
  if (msg.includes("Unsupported HDF5 Alembic archive")) {
    return new UnsupportedCoreTypeError(msg, "HDF5");
  }
  // Never retain Emscripten CppException handles on `cause` so AlembicError stays
  // structuredClone-safe across Web Workers and test runner IPC channels.
  const safeCause =
    cause instanceof Error && !("excPtr" in (cause as unknown as Record<string, unknown>))
      ? { cause }
      : undefined;
  return new AlembicError(msg, cppType, safeCause);
}

export function callWasm<T>(module: AlembicWasmModule, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw decodeWasmException(module, err);
  }
}
