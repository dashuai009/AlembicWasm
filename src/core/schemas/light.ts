import type {
  AlembicWasmModule,
  ILightWrap,
  IObjectWrap,
  OLightWrap,
} from "../../wasm/bindings.js";
import { getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import { fromBox3dDesc, type Box3d } from "../types.js";
import { IObject, OObject } from "../object.js";
import { ICamera, serializeCameraSampleInput, type CameraSampleInput } from "./camera.js";

export class ILight implements Disposable {
  readonly kind = "Light" as const;
  readonly object: IObject;
  readonly handle: ILightWrap;
  private readonly mod: AlembicWasmModule;

  constructor(object: IObject | IObjectWrap, mod = getAlembicModule()) {
    this.mod = mod;
    this.object = object instanceof IObject ? object : new IObject(object, mod);
    this.handle = callWasm(mod, () => new mod.ILightWrap(this.object.handle));
  }

  get valid(): boolean {
    return callWasm(this.mod, () => this.handle.valid());
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

  getCameraSchema(): ICamera | null {
    const camWrap = callWasm(this.mod, () => this.handle.getCameraSchema());
    return camWrap ? new ICamera(camWrap, this.mod) : null;
  }

  getChildBounds(selector?: SampleSelectorInput): Box3d | null {
    const { mode, value } = resolveSampleSelector(selector);
    return fromBox3dDesc(callWasm(this.mod, () => this.handle.getChildBounds(mode, value)));
  }

  getArbGeomParams(): ICompoundProperty | null {
    const raw = callWasm(this.mod, () => this.handle.getArbGeomParams());
    return raw ? new ICompoundProperty(raw, this.mod) : null;
  }

  getUserProperties(): ICompoundProperty | null {
    const raw = callWasm(this.mod, () => this.handle.getUserProperties());
    return raw ? new ICompoundProperty(raw, this.mod) : null;
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

export interface CreateOLightOptions {
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class OLight implements Disposable {
  readonly handle: OLightWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateOLightOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOLight(
        parent.handle,
        name,
        options?.timeSamplingIndex ?? 0,
        normalizeMetaData(options?.metaData)
      )
    );
  }

  get object(): OObject {
    return new OObject(callWasm(this.mod, () => this.handle.getObject()), this.mod);
  }

  get numSamples(): number {
    return callWasm(this.mod, () => this.handle.getNumSamples());
  }

  setCameraSample(sample: CameraSampleInput): void {
    callWasm(this.mod, () => this.handle.setCameraSample(serializeCameraSampleInput(sample)));
  }

  setFromPrevious(): void {
    callWasm(this.mod, () => this.handle.setFromPrevious());
  }

  setTimeSampling(timeSamplingIndex: number): void {
    callWasm(this.mod, () => this.handle.setTimeSampling(timeSamplingIndex));
  }

  getArbGeomParams(): OCompoundProperty {
    return new OCompoundProperty(callWasm(this.mod, () => this.handle.getArbGeomParams()), this.mod);
  }

  getUserProperties(): OCompoundProperty {
    return new OCompoundProperty(callWasm(this.mod, () => this.handle.getUserProperties()), this.mod);
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
