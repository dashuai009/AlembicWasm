import type {
  AlembicWasmModule,
  ICollectionsWrap,
  IObjectWrap,
  OCollectionsWrap,
} from "../../wasm/bindings.js";
import { getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { IArrayProperty, OArrayProperty } from "../properties.js";
import type { SampleSelectorInput } from "../timeSampling.js";
import { IObject, OObject } from "../object.js";

export class ICollections implements Disposable {
  readonly kind = "Collections" as const;
  readonly object: IObject;
  readonly handle: ICollectionsWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.ICollectionsWrap(this.object.handle));
  }

  get valid(): boolean {
    return callWasm(this.mod, () => this.handle.valid());
  }

  get numCollections(): number {
    return callWasm(this.mod, () => this.handle.getNumCollections());
  }

  getCollectionNames(): string[] {
    const n = this.numCollections;
    const names: string[] = [];
    for (let i = 0; i < n; i++) {
      names.push(callWasm(this.mod, () => this.handle.getCollectionName(i)));
    }
    return names;
  }

  getCollectionProperty(nameOrIndex: string | number): IArrayProperty | null {
    const wrap =
      typeof nameOrIndex === "number"
        ? callWasm(this.mod, () => this.handle.getCollectionByIndex(nameOrIndex))
        : callWasm(this.mod, () => this.handle.getCollectionByName(nameOrIndex));
    return wrap ? new IArrayProperty(wrap, this.mod) : null;
  }

  getPaths(nameOrIndex: string | number, selector?: SampleSelectorInput): string[] {
    const prop = this.getCollectionProperty(nameOrIndex);
    if (!prop) {
      return [];
    }
    try {
      return prop.getSample(selector) as string[];
    } finally {
      prop.dispose();
    }
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

export class OCollections implements Disposable {
  readonly handle: OCollectionsWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    metaData?: MetaDataMap,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOCollections(parent.handle, name, normalizeMetaData(metaData))
    );
  }

  get object(): OObject {
    return new OObject(callWasm(this.mod, () => this.handle.getObject()), this.mod);
  }

  get numCollections(): number {
    return callWasm(this.mod, () => this.handle.getNumCollections());
  }

  createCollection(name: string, paths?: readonly string[], timeSamplingIndex = 0): OArrayProperty {
    const propWrap = callWasm(this.mod, () =>
      this.handle.createCollection(name, timeSamplingIndex)
    );
    const prop = new OArrayProperty(propWrap, this.mod);
    if (paths) {
      prop.setSample(paths);
    }
    return prop;
  }

  getCollectionProperty(name: string): OArrayProperty | null {
    const wrap = callWasm(this.mod, () => this.handle.getCollectionByName(name));
    return wrap ? new OArrayProperty(wrap, this.mod) : null;
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
