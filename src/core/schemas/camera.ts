import type {
  AlembicWasmModule,
  ICameraWrap,
  IObjectWrap,
  OCameraWrap,
  RawCameraSample,
  RawFilmBackOpDesc,
} from "../../wasm/bindings.js";
import { getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "../timeSampling.js";
import { fromBox3dDesc, toBox3dDesc, type Box3d } from "../types.js";
import { IObject, OObject } from "../object.js";

export interface CameraSample {
  focalLength: number; // mm
  horizontalAperture: number; // cm
  horizontalFilmOffset: number; // cm
  verticalAperture: number; // cm
  verticalFilmOffset: number; // cm
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
  childBounds: Box3d | null;
  filmBackOps: RawFilmBackOpDesc[];
}

export type CameraSampleInput = Partial<Omit<CameraSample, "screenWindow" | "childBounds">> & {
  childBounds?: Box3d | null;
};

/**
 * Computes vertical field of view in degrees from Alembic's `verticalAperture` (cm)
 * and `focalLength` (mm): `2 * atan((verticalAperture * 10) / (2 * focalLength))`.
 */
export function computeVerticalFovDeg(sample: Pick<CameraSample, "focalLength" | "verticalAperture">): number {
  if (sample.focalLength <= 0 || sample.verticalAperture <= 0) {
    return 50;
  }
  const verticalApertureMm = sample.verticalAperture * 10.0;
  return (2.0 * Math.atan(verticalApertureMm / (2.0 * sample.focalLength)) * 180.0) / Math.PI;
}

export function computeCameraAspect(
  sample: Pick<CameraSample, "horizontalAperture" | "verticalAperture" | "lensSqueezeRatio">
): number {
  if (sample.verticalAperture <= 0) {
    return 16 / 9;
  }
  return (sample.horizontalAperture * (sample.lensSqueezeRatio || 1)) / sample.verticalAperture;
}

export function mapRawCameraSample(raw: RawCameraSample): CameraSample {
  return {
    focalLength: raw.focalLength,
    horizontalAperture: raw.horizontalAperture,
    horizontalFilmOffset: raw.horizontalFilmOffset,
    verticalAperture: raw.verticalAperture,
    verticalFilmOffset: raw.verticalFilmOffset,
    lensSqueezeRatio: raw.lensSqueezeRatio,
    overScanLeft: raw.overScanLeft,
    overScanRight: raw.overScanRight,
    overScanTop: raw.overScanTop,
    overScanBottom: raw.overScanBottom,
    fStop: raw.fStop,
    focusDistance: raw.focusDistance,
    shutterOpen: raw.shutterOpen,
    shutterClose: raw.shutterClose,
    nearClippingPlane: raw.nearClippingPlane,
    farClippingPlane: raw.farClippingPlane,
    screenWindow: raw.screenWindow,
    childBounds: fromBox3dDesc(raw.childBounds),
    filmBackOps: raw.filmBackOps ?? [],
  };
}

export function serializeCameraSampleInput(sample: CameraSampleInput): Record<string, unknown> {
  const out: Record<string, unknown> = { ...sample };
  if ("childBounds" in sample) {
    out.childBounds = toBox3dDesc(sample.childBounds);
  }
  return out;
}

export class ICamera implements Disposable {
  readonly kind = "Camera" as const;
  readonly object: IObject | null;
  readonly handle: ICameraWrap;
  private readonly mod: AlembicWasmModule;

  constructor(objectOrWrap: IObject | IObjectWrap | ICameraWrap, mod = getAlembicModule()) {
    this.mod = mod;
    if (objectOrWrap instanceof IObject) {
      this.object = objectOrWrap;
      this.handle = callWasm(mod, () => new mod.ICameraWrap(objectOrWrap.handle));
    } else if ("getSchemaType" in objectOrWrap) {
      this.object = new IObject(objectOrWrap, mod);
      this.handle = callWasm(mod, () => new mod.ICameraWrap(objectOrWrap));
    } else {
      this.object = null;
      this.handle = objectOrWrap;
    }
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

  getSample(selector?: SampleSelectorInput): CameraSample {
    const { mode, value } = resolveSampleSelector(selector);
    const raw = callWasm(this.mod, () => this.handle.getSample(mode, value));
    return mapRawCameraSample(raw);
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

export interface CreateOCameraOptions {
  timeSamplingIndex?: number;
  metaData?: MetaDataMap;
}

export class OCamera implements Disposable {
  readonly handle: OCameraWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parent: OObject,
    name: string,
    options?: CreateOCameraOptions,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    this.handle = callWasm(mod, () =>
      mod.createOCamera(
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

  setSample(sample: CameraSampleInput): void {
    callWasm(this.mod, () => this.handle.setSample(serializeCameraSampleInput(sample)));
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
