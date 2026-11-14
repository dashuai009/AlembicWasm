import { getAlembicModule } from "../wasm/loader.js";
import { callWasm } from "./errors.js";

export type MetaDataMap = Record<string, string>;

export function normalizeMetaData(meta?: MetaDataMap | null): Record<string, string> {
  if (!meta) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null) {
      out[k] = String(v);
    }
  }
  return out;
}

/**
 * Sets Alembic's `AbcCoreLayer` prune flag (`prune = "1"`) on a metadata map so
 * an upper archive layer prunes a child object or property from lower layers.
 */
export function withLayerPrune(meta?: MetaDataMap, prune = true): Record<string, string> {
  const mod = getAlembicModule();
  return callWasm(mod, () => mod.applyLayerPruneMeta(normalizeMetaData(meta), prune));
}

/**
 * Sets Alembic's `AbcCoreLayer` replace flag (`replace = "1"`) on a metadata map so
 * an upper archive layer replaces a child hierarchy or compound property cleanly.
 */
export function withLayerReplace(meta?: MetaDataMap, replace = true): Record<string, string> {
  const mod = getAlembicModule();
  return callWasm(mod, () => mod.applyLayerReplaceMeta(normalizeMetaData(meta), replace));
}
