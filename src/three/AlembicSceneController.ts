import * as THREE from "three";
import {
  HomogeneousMeshEvaluator,
  IArchive,
  ICamera,
  ICurves,
  INuPatch,
  IObject,
  IPoints,
  IPolyMesh,
  ISubD,
  IXform,
  SampleSelector,
  TimeSampling,
  TopologyVariance,
  computeCameraAspect,
  computeVerticalFovDeg,
  type CameraSample,
  type RenderMeshData,
} from "../index.js";
import { buildAlembicAnimationClip, type BuildAnimationClipOptions } from "./AnimationClipBuilder.js";

export type InterpolationMode = "linear" | "step";

export interface VisibilityBinding {
  object: IObject;
  target: THREE.Object3D;
  timeSampling: TimeSampling;
  numSamples: number;
}

export interface XformBinding {
  xform: IXform;
  target: THREE.Object3D;
  timeSampling: TimeSampling;
  numSamples: number;
}

export interface CameraBinding {
  cameraSchema: ICamera;
  camera: THREE.PerspectiveCamera;
  timeSampling: TimeSampling;
  numSamples: number;
  preserveAspect: boolean;
}

export interface HomogeneousMeshBinding {
  polyMesh: IPolyMesh;
  evaluator: HomogeneousMeshEvaluator;
  geometries: THREE.BufferGeometry[];
  timeSampling: TimeSampling;
  numSamples: number;
}

export interface HeterogeneousMeshBinding {
  polyMesh: IPolyMesh;
  geometries: THREE.BufferGeometry[];
  timeSampling: TimeSampling;
  numSamples: number;
  flatNormals: boolean;
  lastSampleIndex: number;
  lastAdvectDt: number;
}

export interface SubDBinding {
  subd: ISubD;
  geometries: THREE.BufferGeometry[];
  timeSampling: TimeSampling;
  numSamples: number;
  subdLevel: number;
  lastSampleIndex: number;
}

export interface NuPatchBinding {
  nuPatch: INuPatch;
  geometries: THREE.BufferGeometry[];
  timeSampling: TimeSampling;
  numSamples: number;
  uSegments: number;
  vSegments: number;
  lastSampleIndex: number;
}

export interface CurvesBinding {
  curves: ICurves;
  geometries: THREE.BufferGeometry[];
  timeSampling: TimeSampling;
  numSamples: number;
  segmentsPerSpan: number;
  lastSampleIndex: number;
}

export interface PointsBinding {
  points: IPoints;
  geometries: THREE.BufferGeometry[];
  timeSampling: TimeSampling;
  numSamples: number;
  lastSampleIndex: number;
}

const _mat4 = new THREE.Matrix4();
const _parentInv = new THREE.Matrix4();
const _c0 = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/**
 * Applies a 16-element Alembic `M44d` matrix to a `THREE.Object3D`.
 * Decomposes into `(position, quaternion, scale)` when the basis is orthogonal (shear-free),
 * and falls back to `matrixAutoUpdate = false` when sheared or when `inherits === false`.
 */
export function applyAlembicMatrixToObject3D(
  target: THREE.Object3D,
  m16: ArrayLike<number>,
  inherits = true
): void {
  _mat4.fromArray(m16);

  if (!inherits && target.parent) {
    target.parent.updateWorldMatrix(true, false);
    _parentInv.copy(target.parent.matrixWorld).invert();
    _mat4.premultiply(_parentInv);
  }

  const e = _mat4.elements;
  _c0.set(e[0]!, e[1]!, e[2]!);
  _c1.set(e[4]!, e[5]!, e[6]!);
  _c2.set(e[8]!, e[9]!, e[10]!);

  const l0 = _c0.length();
  const l1 = _c1.length();
  const l2 = _c2.length();
  let hasShear = l0 < 1e-8 || l1 < 1e-8 || l2 < 1e-8;
  if (!hasShear) {
    _c0.multiplyScalar(1 / l0);
    _c1.multiplyScalar(1 / l1);
    _c2.multiplyScalar(1 / l2);
    if (
      Math.abs(_c0.dot(_c1)) > 1e-4 ||
      Math.abs(_c0.dot(_c2)) > 1e-4 ||
      Math.abs(_c1.dot(_c2)) > 1e-4
    ) {
      hasShear = true;
    }
  }

  if (hasShear) {
    target.matrixAutoUpdate = false;
    target.matrix.copy(_mat4);
    target.matrixWorldNeedsUpdate = true;
  } else {
    target.matrixAutoUpdate = true;
    _mat4.decompose(target.position, target.quaternion, target.scale);
    target.updateMatrix();
  }
}

export function applyCameraSampleToThree(
  cam: THREE.PerspectiveCamera,
  sample: CameraSample,
  preserveAspect = false
): void {
  cam.fov = computeVerticalFovDeg(sample);
  if (!preserveAspect) {
    cam.aspect = computeCameraAspect(sample);
  }
  cam.filmGauge = sample.horizontalAperture * 10;
  cam.filmOffset = sample.horizontalFilmOffset * 10;
  cam.focus = sample.focusDistance;
  cam.near = Math.max(1e-4, sample.nearClippingPlane);
  cam.far = Math.max(cam.near + 1, sample.farClippingPlane);
  cam.updateProjectionMatrix();
}

export function applyRenderMeshToGeometry(
  geom: THREE.BufferGeometry,
  data: RenderMeshData
): void {
  const existingPos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (existingPos && existingPos.array.length === data.positions.length) {
    (existingPos.array as Float32Array).set(data.positions);
    existingPos.needsUpdate = true;
  } else {
    geom.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  }

  if (data.normals.length > 0) {
    const existingNorm = geom.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (existingNorm && existingNorm.array.length === data.normals.length) {
      (existingNorm.array as Float32Array).set(data.normals);
      existingNorm.needsUpdate = true;
    } else {
      geom.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    }
  } else {
    geom.deleteAttribute("normal");
  }

  if (data.uvs && data.uvs.length > 0) {
    const existingUv = geom.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (existingUv && existingUv.array.length === data.uvs.length) {
      (existingUv.array as Float32Array).set(data.uvs);
      existingUv.needsUpdate = true;
    } else {
      geom.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
    }
  } else {
    geom.deleteAttribute("uv");
  }

  if (data.colors && data.colors.length > 0) {
    const existingCol = geom.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (existingCol && existingCol.array.length === data.colors.length) {
      (existingCol.array as Float32Array).set(data.colors);
      existingCol.needsUpdate = true;
    } else {
      geom.setAttribute("color", new THREE.BufferAttribute(data.colors, 4));
    }
  } else {
    geom.deleteAttribute("color");
  }

  const existingIndex = geom.getIndex();
  if (existingIndex && existingIndex.array.length === data.indices.length) {
    (existingIndex.array as Uint32Array).set(data.indices);
    existingIndex.needsUpdate = true;
  } else {
    geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
  }

  geom.clearGroups();
  for (const g of data.groups) {
    geom.addGroup(g.start, g.count, g.materialIndex);
  }

  if (data.bounds) {
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(...data.bounds.min),
      new THREE.Vector3(...data.bounds.max)
    );
    geom.boundingSphere = new THREE.Sphere();
    geom.boundingBox.getBoundingSphere(geom.boundingSphere);
  } else {
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
  }
}

/**
 * Streaming arbitrary-time evaluator for an Alembic archive loaded into a Three.js `Group`.
 * Supports constant, homogeneous (interpolated), and heterogeneous (fluid/topology-varying) caches.
 */
export class AlembicSceneController implements Disposable {
  readonly archive: IArchive;
  readonly root: THREE.Group;
  readonly cameras: THREE.PerspectiveCamera[];

  readonly visibilityBindings: VisibilityBinding[] = [];
  readonly xformBindings: XformBinding[] = [];
  readonly cameraBindings: CameraBinding[] = [];
  readonly homogeneousMeshBindings: HomogeneousMeshBinding[] = [];
  readonly heterogeneousMeshBindings: HeterogeneousMeshBinding[] = [];
  readonly subdBindings: SubDBinding[] = [];
  readonly nuPatchBindings: NuPatchBinding[] = [];
  readonly curvesBindings: CurvesBinding[] = [];
  readonly pointsBindings: PointsBinding[] = [];

  startTime = 0;
  endTime = 0;
  fps = 24;
  currentTime = 0;
  playing = true;
  loop = true;
  playbackRate = 1.0;
  interpolation: InterpolationMode = "linear";
  useVelocityAdvection = true;

  private disposed = false;

  constructor(params: {
    archive: IArchive;
    root: THREE.Group;
    cameras?: THREE.PerspectiveCamera[];
  }) {
    this.archive = params.archive;
    this.root = params.root;
    this.cameras = params.cameras ?? [];
  }

  get duration(): number {
    return Math.max(0, this.endTime - this.startTime);
  }

  get isAnimated(): boolean {
    return (
      this.duration > 1e-6 ||
      this.xformBindings.length > 0 ||
      this.cameraBindings.length > 0 ||
      this.homogeneousMeshBindings.length > 0 ||
      this.heterogeneousMeshBindings.length > 0 ||
      this.subdBindings.length > 0 ||
      this.nuPatchBindings.length > 0 ||
      this.curvesBindings.length > 0 ||
      this.pointsBindings.length > 0 ||
      this.visibilityBindings.length > 0
    );
  }

  get frameCount(): number {
    if (this.duration <= 1e-9) {
      return 1;
    }
    return Math.max(1, Math.round(this.duration * this.fps) + 1);
  }

  get currentFrame(): number {
    if (this.fps <= 0) {
      return 0;
    }
    return Math.max(0, Math.round((this.currentTime - this.startTime) * this.fps));
  }

  finalizeTimeMetrics(): void {
    const info = this.archive.info;
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;
    let detectedFps = info.dccFps > 0 ? info.dccFps : 0;

    const inspectTrack = (ts: TimeSampling, numSamples: number) => {
      if (numSamples > 1) {
        const range = ts.getTimeRange(numSamples);
        minStart = Math.min(minStart, range.startTime);
        maxEnd = Math.max(maxEnd, range.endTime);
        if (detectedFps <= 0 && ts.fps > 0) {
          detectedFps = ts.fps;
        }
      }
    };

    for (const b of this.visibilityBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.xformBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.cameraBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.homogeneousMeshBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.heterogeneousMeshBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.subdBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.nuPatchBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.curvesBindings) inspectTrack(b.timeSampling, b.numSamples);
    for (const b of this.pointsBindings) inspectTrack(b.timeSampling, b.numSamples);

    if (minStart <= maxEnd && Number.isFinite(minStart) && Number.isFinite(maxEnd)) {
      this.startTime = minStart;
      this.endTime = maxEnd;
    } else if (info.hasTimeRange && info.startTime <= info.endTime) {
      this.startTime = info.startTime;
      this.endTime = info.endTime;
    } else {
      this.startTime = 0;
      this.endTime = 0;
    }

    if (detectedFps <= 0) {
      for (const ts of this.archive.getTimeSamplings()) {
        if (ts.maxNumSamples > 1 && ts.fps > 0) {
          detectedFps = ts.fps;
          break;
        }
      }
    }
    this.fps = detectedFps > 0 ? detectedFps : 24;
    this.currentTime = this.startTime;
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  setFrame(frameIndex: number): void {
    const t = this.startTime + Math.max(0, frameIndex) / Math.max(1e-6, this.fps);
    this.setTime(Math.min(this.endTime, t));
  }

  update(deltaSeconds: number): void {
    if (!this.playing || this.disposed) {
      return;
    }
    const dur = this.duration;
    if (dur <= 1e-9) {
      return;
    }
    let next = this.currentTime + deltaSeconds * this.playbackRate;
    if (this.loop) {
      const rel = ((next - this.startTime) % dur + dur) % dur;
      next = this.startTime + rel;
    } else if (next >= this.endTime) {
      next = this.endTime;
      this.playing = false;
    } else if (next <= this.startTime) {
      next = this.startTime;
      this.playing = false;
    }
    this.setTime(next);
  }

  setTime(timeSeconds: number): void {
    if (this.disposed || this.archive.isClosed) {
      return;
    }
    const clampedTime =
      this.duration > 0
        ? Math.max(this.startTime, Math.min(this.endTime, timeSeconds))
        : timeSeconds;
    this.currentTime = clampedTime;

    const linear = this.interpolation === "linear";
    const floorSel = SampleSelector.floor(clampedTime);

    // 1. Visibility
    for (const b of this.visibilityBindings) {
      b.target.visible = b.object.isVisibleAt(floorSel);
    }

    // 2. Xforms (sorted parent-before-child by construction order)
    for (const b of this.xformBindings) {
      const inherits = b.xform.getInheritsXforms(floorSel);
      const m16 = linear
        ? b.xform.getInterpolatedMatrix(clampedTime, false)
        : b.xform.getMatrix(floorSel, false);
      applyAlembicMatrixToObject3D(b.target, m16, inherits);
    }

    // 3. Cameras
    for (const b of this.cameraBindings) {
      if (linear && b.numSamples > 1) {
        const br = b.timeSampling.getBracketingSamples(clampedTime, b.numSamples);
        const s0 = b.cameraSchema.getSample(br.index0);
        if (br.alpha <= 1e-6 || br.index0 === br.index1) {
          applyCameraSampleToThree(b.camera, s0, b.preserveAspect);
        } else {
          const s1 = b.cameraSchema.getSample(br.index1);
          const a = br.alpha;
          const blended: CameraSample = {
            ...s0,
            focalLength: s0.focalLength + (s1.focalLength - s0.focalLength) * a,
            horizontalAperture:
              s0.horizontalAperture + (s1.horizontalAperture - s0.horizontalAperture) * a,
            verticalAperture:
              s0.verticalAperture + (s1.verticalAperture - s0.verticalAperture) * a,
            horizontalFilmOffset:
              s0.horizontalFilmOffset + (s1.horizontalFilmOffset - s0.horizontalFilmOffset) * a,
            verticalFilmOffset:
              s0.verticalFilmOffset + (s1.verticalFilmOffset - s0.verticalFilmOffset) * a,
            focusDistance: s0.focusDistance + (s1.focusDistance - s0.focusDistance) * a,
            fStop: s0.fStop + (s1.fStop - s0.fStop) * a,
            nearClippingPlane:
              s0.nearClippingPlane + (s1.nearClippingPlane - s0.nearClippingPlane) * a,
            farClippingPlane:
              s0.farClippingPlane + (s1.farClippingPlane - s0.farClippingPlane) * a,
          };
          applyCameraSampleToThree(b.camera, blended, b.preserveAspect);
        }
      } else {
        applyCameraSampleToThree(b.camera, b.cameraSchema.getSample(floorSel), b.preserveAspect);
      }
    }

    // 4. Homogeneous deforming PolyMeshes (zero-allocation C++ interpolation)
    for (const b of this.homogeneousMeshBindings) {
      const { positions, normals } = b.evaluator.evaluateAtTime(clampedTime, {
        interpolate: linear,
        copy: false,
      });
      for (const geom of b.geometries) {
        const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
        if (posAttr && posAttr.array.length === positions.length) {
          (posAttr.array as Float32Array).set(positions);
          posAttr.needsUpdate = true;
        }
        const normAttr = geom.getAttribute("normal") as THREE.BufferAttribute | undefined;
        if (normAttr && normAttr.array.length === normals.length) {
          (normAttr.array as Float32Array).set(normals);
          normAttr.needsUpdate = true;
        }
      }
    }

    // 5. Heterogeneous PolyMeshes (fluids, cloth tearing, particle remeshing)
    for (const b of this.heterogeneousMeshBindings) {
      const br = b.timeSampling.getBracketingSamples(clampedTime, b.numSamples);
      const advectDt = linear && this.useVelocityAdvection ? br.dtFromFloor : 0;
      if (
        b.lastSampleIndex === br.index0 &&
        Math.abs(b.lastAdvectDt - advectDt) < 1e-6
      ) {
        continue;
      }
      b.lastSampleIndex = br.index0;
      b.lastAdvectDt = advectDt;
      const data = b.polyMesh.buildRenderMesh(br.index0, {
        reverseWinding: true,
        flatNormals: b.flatNormals,
        velocityDt: advectDt,
      });
      for (const geom of b.geometries) {
        applyRenderMeshToGeometry(geom, data);
      }
    }

    // 6. SubD surfaces
    for (const b of this.subdBindings) {
      const br = b.timeSampling.getBracketingSamples(clampedTime, b.numSamples);
      if (
        linear &&
        b.subd.topologyVariance === TopologyVariance.Homogeneous &&
        br.index0 !== br.index1 &&
        br.alpha > 1e-6
      ) {
        const m0 = b.subd.buildRenderMesh(br.index0, { subdLevel: b.subdLevel });
        const m1 = b.subd.buildRenderMesh(br.index1, { subdLevel: b.subdLevel });
        if (m0.positions.length === m1.positions.length) {
          lerpFloat32InPlace(m0.positions, m1.positions, br.alpha);
          lerpNormalsInPlace(m0.normals, m1.normals, br.alpha);
        }
        b.lastSampleIndex = -1;
        for (const geom of b.geometries) applyRenderMeshToGeometry(geom, m0);
      } else if (b.lastSampleIndex !== br.index0) {
        b.lastSampleIndex = br.index0;
        const m0 = b.subd.buildRenderMesh(br.index0, { subdLevel: b.subdLevel });
        for (const geom of b.geometries) applyRenderMeshToGeometry(geom, m0);
      }
    }

    // 7. NuPatch surfaces
    for (const b of this.nuPatchBindings) {
      const br = b.timeSampling.getBracketingSamples(clampedTime, b.numSamples);
      if (b.lastSampleIndex !== br.index0) {
        b.lastSampleIndex = br.index0;
        const m0 = b.nuPatch.buildRenderMesh(br.index0, {
          uSegments: b.uSegments,
          vSegments: b.vSegments,
        });
        for (const geom of b.geometries) applyRenderMeshToGeometry(geom, m0);
      }
    }

    // 8. Curves
    for (const b of this.curvesBindings) {
      const br = b.timeSampling.getBracketingSamples(clampedTime, b.numSamples);
      if (
        linear &&
        b.curves.topologyVariance !== TopologyVariance.Heterogeneous &&
        br.index0 !== br.index1 &&
        br.alpha > 1e-6
      ) {
        const c0 = b.curves.evaluateForRender(br.index0, b.segmentsPerSpan);
        const c1 = b.curves.evaluateForRender(br.index1, b.segmentsPerSpan);
        if (c0.segmentPositions.length === c1.segmentPositions.length) {
          lerpFloat32InPlace(c0.segmentPositions, c1.segmentPositions, br.alpha);
        }
        b.lastSampleIndex = -1;
        for (const geom of b.geometries) {
          updateLinePositions(geom, c0.segmentPositions);
        }
      } else if (b.lastSampleIndex !== br.index0) {
        b.lastSampleIndex = br.index0;
        const c0 = b.curves.evaluateForRender(br.index0, b.segmentsPerSpan);
        for (const geom of b.geometries) {
          updateLinePositions(geom, c0.segmentPositions);
        }
      }
    }

    // 9. Points
    for (const b of this.pointsBindings) {
      const br = b.timeSampling.getBracketingSamples(clampedTime, b.numSamples);
      const s0 = b.points.getSample(br.index0);
      const pos = s0.positions;
      if (linear && this.useVelocityAdvection && s0.velocities && Math.abs(br.dtFromFloor) > 1e-6) {
        const vel = s0.velocities;
        const dt = br.dtFromFloor;
        const n = Math.min(pos.length, vel.length);
        for (let i = 0; i < n; i++) {
          pos[i] = pos[i]! + vel[i]! * dt;
        }
        b.lastSampleIndex = -1;
      } else if (b.lastSampleIndex === br.index0) {
        continue;
      } else {
        b.lastSampleIndex = br.index0;
      }
      for (const geom of b.geometries) {
        updatePointPositions(geom, pos);
      }
    }
  }

  /**
   * Builds a standard `THREE.AnimationClip` from the archive's Xform, Camera, Visibility,
   * and homogeneous mesh deformation tracks for use with `THREE.AnimationMixer`.
   */
  toAnimationClip(options?: BuildAnimationClipOptions): THREE.AnimationClip {
    return buildAlembicAnimationClip(this, options);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const b of this.homogeneousMeshBindings) {
      b.evaluator.dispose();
      b.polyMesh.dispose();
    }
    for (const b of this.heterogeneousMeshBindings) b.polyMesh.dispose();
    for (const b of this.subdBindings) b.subd.dispose();
    for (const b of this.nuPatchBindings) b.nuPatch.dispose();
    for (const b of this.curvesBindings) b.curves.dispose();
    for (const b of this.pointsBindings) b.points.dispose();
    for (const b of this.xformBindings) b.xform.dispose();
    for (const b of this.cameraBindings) b.cameraSchema.dispose();
    for (const b of this.visibilityBindings) b.object.dispose();
    this.archive.close();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

function lerpFloat32InPlace(dst: Float32Array, target: Float32Array, alpha: number): void {
  const oneMinus = 1 - alpha;
  for (let i = 0; i < dst.length; i++) {
    dst[i] = dst[i]! * oneMinus + target[i]! * alpha;
  }
}

function lerpNormalsInPlace(dst: Float32Array, target: Float32Array, alpha: number): void {
  const oneMinus = 1 - alpha;
  for (let i = 0; i + 2 < dst.length; i += 3) {
    let nx = dst[i]! * oneMinus + target[i]! * alpha;
    let ny = dst[i + 1]! * oneMinus + target[i + 1]! * alpha;
    let nz = dst[i + 2]! * oneMinus + target[i + 2]! * alpha;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    dst[i] = nx;
    dst[i + 1] = ny;
    dst[i + 2] = nz;
  }
}

function updateLinePositions(geom: THREE.BufferGeometry, segPos: Float32Array): void {
  const attr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (attr && attr.array.length === segPos.length) {
    (attr.array as Float32Array).set(segPos);
    attr.needsUpdate = true;
  } else {
    geom.setAttribute("position", new THREE.BufferAttribute(segPos, 3));
  }
  geom.computeBoundingSphere();
}

function updatePointPositions(geom: THREE.BufferGeometry, pos: Float32Array): void {
  const attr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (attr && attr.array.length === pos.length) {
    (attr.array as Float32Array).set(pos);
    attr.needsUpdate = true;
  } else {
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  }
  geom.computeBoundingSphere();
}
