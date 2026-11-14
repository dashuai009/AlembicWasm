export * from "./xform.js";
export * from "./camera.js";
export * from "./light.js";
export * from "./faceSet.js";
export * from "./polyMesh.js";
export * from "./subd.js";
export * from "./curves.js";
export * from "./points.js";
export * from "./nuPatch.js";
export * from "./material.js";
export * from "./collections.js";

import type { IXform } from "./xform.js";
import type { ICamera } from "./camera.js";
import type { ILight } from "./light.js";
import type { IFaceSet } from "./faceSet.js";
import type { IPolyMesh } from "./polyMesh.js";
import type { ISubD } from "./subd.js";
import type { ICurves } from "./curves.js";
import type { IPoints } from "./points.js";
import type { INuPatch } from "./nuPatch.js";
import type { IMaterial } from "./material.js";
import type { ICollections } from "./collections.js";

export type AnyISchema =
  | IXform
  | IPolyMesh
  | ISubD
  | IFaceSet
  | ICamera
  | ICurves
  | IPoints
  | INuPatch
  | ILight
  | IMaterial
  | ICollections;
