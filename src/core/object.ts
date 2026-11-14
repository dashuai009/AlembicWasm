import type {
  AlembicWasmModule,
  IObjectWrap,
  OObjectWrap,
} from "../wasm/bindings.js";
import { getAlembicModule } from "../wasm/loader.js";
import { callWasm } from "./errors.js";
import { normalizeMetaData, type MetaDataMap } from "./metadata.js";
import { ICompoundProperty, IScalarProperty, OCompoundProperty } from "./properties.js";
import { resolveSampleSelector, type SampleSelectorInput } from "./timeSampling.js";
import { ObjectVisibility, type SchemaKind } from "./types.js";
import { IXform, OXform, type CreateOXformOptions } from "./schemas/xform.js";
import { ICamera, OCamera, type CreateOCameraOptions } from "./schemas/camera.js";
import { ILight, OLight, type CreateOLightOptions } from "./schemas/light.js";
import { IFaceSet, OFaceSet, type CreateOFaceSetOptions } from "./schemas/faceSet.js";
import { IPolyMesh, OPolyMesh, type CreateOPolyMeshOptions } from "./schemas/polyMesh.js";
import { ISubD, OSubD, type CreateOSubDOptions } from "./schemas/subd.js";
import { ICurves, OCurves, type CreateOCurvesOptions } from "./schemas/curves.js";
import { IPoints, OPoints, type CreateOPointsOptions } from "./schemas/points.js";
import { INuPatch, ONuPatch, type CreateONuPatchOptions } from "./schemas/nuPatch.js";
import {
  FlattenedMaterial,
  IMaterial,
  OMaterial,
  addLocalMaterial,
  assignMaterial,
  flattenObjectMaterial,
  getLocalMaterial,
  getMaterialAssignmentPath,
} from "./schemas/material.js";
import { ICollections, OCollections } from "./schemas/collections.js";
import type { AnyISchema } from "./schemas/index.js";

export class IObject implements Disposable {
  readonly handle: IObjectWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: IObjectWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get valid(): boolean {
    return callWasm(this.mod, () => this.handle.valid());
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get fullName(): string {
    return callWasm(this.mod, () => this.handle.getFullName());
  }

  get schemaType(): SchemaKind {
    return callWasm(this.mod, () => this.handle.getSchemaType() as SchemaKind);
  }

  get schemaString(): string {
    return callWasm(this.mod, () => this.handle.getSchemaString());
  }

  get metaData(): Record<string, string> {
    return callWasm(this.mod, () => this.handle.getMetaData());
  }

  get numChildren(): number {
    return callWasm(this.mod, () => this.handle.getNumChildren());
  }

  hasChild(name: string): boolean {
    return callWasm(this.mod, () => this.handle.hasChild(name));
  }

  getChild(indexOrName: number | string): IObject | null {
    const raw =
      typeof indexOrName === "number"
        ? callWasm(this.mod, () => this.handle.getChildByIndex(indexOrName))
        : callWasm(this.mod, () => this.handle.getChildByName(indexOrName));
    return raw ? new IObject(raw, this.mod) : null;
  }

  children(): IObject[] {
    const count = this.numChildren;
    const result: IObject[] = [];
    for (let i = 0; i < count; i++) {
      const child = this.getChild(i);
      if (child) {
        result.push(child);
      }
    }
    return result;
  }

  /**
   * Resolves a slash-delimited hierarchy path (`"/root/geo/mesh"` or `"geo/mesh"`) relative to this object.
   */
  findByPath(path: string): IObject | null {
    const segments = path.split("/").filter((s) => s.length > 0 && s !== "ABC");
    if (segments.length === 0) {
      return new IObject(this.handle, this.mod);
    }
    let cur: IObject | null = this;
    const ownedIntermediates: IObject[] = [];
    for (let i = 0; i < segments.length; i++) {
      const next: IObject | null = cur.getChild(segments[i]!);
      if (!next) {
        for (const tmp of ownedIntermediates) {
          tmp.dispose();
        }
        return null;
      }
      if (i < segments.length - 1) {
        ownedIntermediates.push(next);
      }
      cur = next;
    }
    for (const tmp of ownedIntermediates) {
      tmp.dispose();
    }
    return cur;
  }

  /**
   * Depth-first traversal of this object and all descendants. Returning `false` from `visitor`
   * skips traversing that node's children. Intermediate child handles not retained are NOT auto-disposed
   * during callback execution so callers may keep references if desired, or inspect properties safely.
   */
  traverse(visitor: (obj: IObject, depth: number) => void | false, depth = 0): void {
    const cont = visitor(this, depth);
    if (cont === false) {
      return;
    }
    const n = this.numChildren;
    for (let i = 0; i < n; i++) {
      const child = this.getChild(i);
      if (child) {
        child.traverse(visitor, depth + 1);
      }
    }
  }

  getProperties(): ICompoundProperty {
    return new ICompoundProperty(callWasm(this.mod, () => this.handle.getProperties()), this.mod);
  }

  get isInstanceRoot(): boolean {
    return callWasm(this.mod, () => this.handle.isInstanceRoot());
  }

  get isInstanceDescendant(): boolean {
    return callWasm(this.mod, () => this.handle.isInstanceDescendant());
  }

  get instanceSourcePath(): string {
    return callWasm(this.mod, () => this.handle.instanceSourcePath());
  }

  getVisibility(selector?: SampleSelectorInput): ObjectVisibility {
    const { mode, value } = resolveSampleSelector(selector);
    return callWasm(this.mod, () => this.handle.getVisibility(mode, value) as ObjectVisibility);
  }

  isAncestorInvisible(selector?: SampleSelectorInput): boolean {
    const { mode, value } = resolveSampleSelector(selector);
    return callWasm(this.mod, () => this.handle.isAncestorInvisible(mode, value));
  }

  /**
   * Resolves effective visibility at `selector` accounting for `kDeferred` inheritance from ancestors.
   */
  isVisibleAt(selector?: SampleSelectorInput): boolean {
    const own = this.getVisibility(selector);
    if (own === ObjectVisibility.Hidden) {
      return false;
    }
    if (own === ObjectVisibility.Visible) {
      return !this.isAncestorInvisible(selector);
    }
    return !this.isAncestorInvisible(selector);
  }

  getVisibilityProperty(): IScalarProperty | null {
    const raw = callWasm(this.mod, () => this.handle.getVisibilityProperty());
    return raw ? new IScalarProperty(raw, this.mod) : null;
  }

  getMaterialAssignmentPath(): string | null {
    return getMaterialAssignmentPath(this);
  }

  getLocalMaterial(): IMaterial | null {
    return getLocalMaterial(this);
  }

  flattenMaterial(): FlattenedMaterial {
    return flattenObjectMaterial(this);
  }

  asSchema(): AnyISchema | null {
    switch (this.schemaType) {
      case "Xform":
        return new IXform(this, this.mod);
      case "PolyMesh":
        return new IPolyMesh(this, this.mod);
      case "SubD":
        return new ISubD(this, this.mod);
      case "FaceSet":
        return new IFaceSet(this, this.mod);
      case "Camera":
        return new ICamera(this, this.mod);
      case "Curves":
        return new ICurves(this, this.mod);
      case "Points":
        return new IPoints(this, this.mod);
      case "NuPatch":
        return new INuPatch(this, this.mod);
      case "Light":
        return new ILight(this, this.mod);
      case "Material":
        return new IMaterial(this, this.mod);
      case "Collections":
        return new ICollections(this, this.mod);
      default:
        return null;
    }
  }

  asXform(): IXform | null {
    return this.schemaType === "Xform" ? new IXform(this, this.mod) : null;
  }

  asPolyMesh(): IPolyMesh | null {
    return this.schemaType === "PolyMesh" ? new IPolyMesh(this, this.mod) : null;
  }

  asSubD(): ISubD | null {
    return this.schemaType === "SubD" ? new ISubD(this, this.mod) : null;
  }

  asFaceSet(): IFaceSet | null {
    return this.schemaType === "FaceSet" ? new IFaceSet(this, this.mod) : null;
  }

  asCamera(): ICamera | null {
    return this.schemaType === "Camera" ? new ICamera(this, this.mod) : null;
  }

  asCurves(): ICurves | null {
    return this.schemaType === "Curves" ? new ICurves(this, this.mod) : null;
  }

  asPoints(): IPoints | null {
    return this.schemaType === "Points" ? new IPoints(this, this.mod) : null;
  }

  asNuPatch(): INuPatch | null {
    return this.schemaType === "NuPatch" ? new INuPatch(this, this.mod) : null;
  }

  asLight(): ILight | null {
    return this.schemaType === "Light" ? new ILight(this, this.mod) : null;
  }

  asMaterial(): IMaterial | null {
    return this.schemaType === "Material" ? new IMaterial(this, this.mod) : null;
  }

  asCollections(): ICollections | null {
    return this.schemaType === "Collections" ? new ICollections(this, this.mod) : null;
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

export class OObject implements Disposable {
  readonly handle: OObjectWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: OObjectWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get valid(): boolean {
    return callWasm(this.mod, () => this.handle.valid());
  }

  get name(): string {
    return callWasm(this.mod, () => this.handle.getName());
  }

  get fullName(): string {
    return callWasm(this.mod, () => this.handle.getFullName());
  }

  get metaData(): Record<string, string> {
    return callWasm(this.mod, () => this.handle.getMetaData());
  }

  get numChildren(): number {
    return callWasm(this.mod, () => this.handle.getNumChildren());
  }

  addChild(name: string, metaData?: MetaDataMap): OObject {
    const raw = callWasm(this.mod, () =>
      this.handle.addChild(name, normalizeMetaData(metaData))
    );
    return new OObject(raw, this.mod);
  }

  addChildInstance(target: OObject, name: string): boolean {
    return callWasm(this.mod, () => this.handle.addChildInstance(target.handle, name));
  }

  getProperties(): OCompoundProperty {
    return new OCompoundProperty(callWasm(this.mod, () => this.handle.getProperties()), this.mod);
  }

  setVisibility(visibility: ObjectVisibility, timeSamplingIndex = 0): void {
    callWasm(this.mod, () => this.handle.setVisibility(visibility, timeSamplingIndex));
  }

  assignMaterial(materialFullPath: string): void {
    assignMaterial(this, materialFullPath);
  }

  addLocalMaterial(): OMaterial {
    return addLocalMaterial(this);
  }

  addXform(name: string, options?: CreateOXformOptions): OXform {
    return new OXform(this, name, options, this.mod);
  }

  addPolyMesh(name: string, options?: CreateOPolyMeshOptions): OPolyMesh {
    return new OPolyMesh(this, name, options, this.mod);
  }

  addSubD(name: string, options?: CreateOSubDOptions): OSubD {
    return new OSubD(this, name, options, this.mod);
  }

  addFaceSet(name: string, options?: CreateOFaceSetOptions): OFaceSet {
    return new OFaceSet(this, name, options, this.mod);
  }

  addCamera(name: string, options?: CreateOCameraOptions): OCamera {
    return new OCamera(this, name, options, this.mod);
  }

  addCurves(name: string, options?: CreateOCurvesOptions): OCurves {
    return new OCurves(this, name, options, this.mod);
  }

  addPoints(name: string, options?: CreateOPointsOptions): OPoints {
    return new OPoints(this, name, options, this.mod);
  }

  addNuPatch(name: string, options?: CreateONuPatchOptions): ONuPatch {
    return new ONuPatch(this, name, options, this.mod);
  }

  addLight(name: string, options?: CreateOLightOptions): OLight {
    return new OLight(this, name, options, this.mod);
  }

  addMaterial(name: string, metaData?: MetaDataMap): OMaterial {
    return new OMaterial(this, name, metaData, this.mod);
  }

  addCollections(name: string, metaData?: MetaDataMap): OCollections {
    return new OCollections(this, name, metaData, this.mod);
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
