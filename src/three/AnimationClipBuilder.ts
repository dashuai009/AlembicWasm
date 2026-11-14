import * as THREE from "three";
import { computeVerticalFovDeg } from "../index.js";
import type { AlembicSceneController } from "./AlembicSceneController.js";

export interface BuildAnimationClipOptions {
  /** Clip name (defaults to `"AlembicAnimation"`). */
  name?: string;
  /** Whether to bake homogeneous deforming PolyMeshes into MorphTarget tracks (default `true`). */
  includeMorphTargets?: boolean;
  /** Safeguard cap on morph target keyframes per mesh (default `120`). */
  maxMorphFrames?: number;
}

/**
 * Converts an `AlembicSceneController`'s animated Xform, Camera, Visibility, and homogeneous
 * PolyMesh deformation bindings into a standard `THREE.AnimationClip` compatible with `THREE.AnimationMixer`.
 *
 * Note: Heterogeneous topology meshes (e.g., fluid simulations whose vertex count changes per frame)
 * cannot be represented by static `THREE.KeyframeTrack`s — use `controller.update(dt)` / `controller.setTime(t)`
 * to stream heterogeneous topology animations.
 */
export function buildAlembicAnimationClip(
  controller: AlembicSceneController,
  options?: BuildAnimationClipOptions
): THREE.AnimationClip {
  const clipName = options?.name ?? "AlembicAnimation";
  const includeMorphs = options?.includeMorphTargets ?? true;
  const maxMorphFrames = options?.maxMorphFrames ?? 120;
  const startOffset = controller.startTime;

  const tracks: THREE.KeyframeTrack[] = [];
  const tmpMat = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();

  // 1. Xform tracks
  for (const b of controller.xformBindings) {
    const n = b.numSamples;
    if (n <= 0) continue;
    const trackTarget = ensureTrackUuid(b.target);
    const times = new Float32Array(n);
    const positions = new Float32Array(n * 3);
    const quaternions = new Float32Array(n * 4);
    const scales = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      times[i] = Math.max(0, b.timeSampling.getSampleTime(i) - startOffset);
      const m16 = b.xform.getMatrix(i, false);
      tmpMat.fromArray(m16);
      tmpMat.decompose(tmpPos, tmpQuat, tmpScale);
      // Enforce quaternion hemisphere continuity to avoid 360-deg slerp flips
      if (i > 0) {
        const prevDot =
          quaternions[(i - 1) * 4]! * tmpQuat.x +
          quaternions[(i - 1) * 4 + 1]! * tmpQuat.y +
          quaternions[(i - 1) * 4 + 2]! * tmpQuat.z +
          quaternions[(i - 1) * 4 + 3]! * tmpQuat.w;
        if (prevDot < 0) {
          tmpQuat.set(-tmpQuat.x, -tmpQuat.y, -tmpQuat.z, -tmpQuat.w);
        }
      }
      positions[i * 3] = tmpPos.x;
      positions[i * 3 + 1] = tmpPos.y;
      positions[i * 3 + 2] = tmpPos.z;
      quaternions[i * 4] = tmpQuat.x;
      quaternions[i * 4 + 1] = tmpQuat.y;
      quaternions[i * 4 + 2] = tmpQuat.z;
      quaternions[i * 4 + 3] = tmpQuat.w;
      scales[i * 3] = tmpScale.x;
      scales[i * 3 + 1] = tmpScale.y;
      scales[i * 3 + 2] = tmpScale.z;
    }

    b.target.matrixAutoUpdate = true;
    tracks.push(new THREE.VectorKeyframeTrack(`${trackTarget}.position`, times, positions));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${trackTarget}.quaternion`, times, quaternions));
    tracks.push(new THREE.VectorKeyframeTrack(`${trackTarget}.scale`, times, scales));
  }

  // 2. Visibility tracks
  for (const b of controller.visibilityBindings) {
    const n = b.numSamples;
    if (n <= 0) continue;
    const trackTarget = ensureTrackUuid(b.target);
    const times: number[] = [];
    const values: boolean[] = [];
    for (let i = 0; i < n; i++) {
      times.push(Math.max(0, b.timeSampling.getSampleTime(i) - startOffset));
      values.push(b.object.isVisibleAt(i));
    }
    tracks.push(new THREE.BooleanKeyframeTrack(`${trackTarget}.visible`, times, values));
  }

  // 3. Camera optical parameter tracks
  for (const b of controller.cameraBindings) {
    const n = b.numSamples;
    if (n <= 0) continue;
    const trackTarget = ensureTrackUuid(b.camera);
    const times = new Float32Array(n);
    const fovs = new Float32Array(n);
    const focuses = new Float32Array(n);
    const nears = new Float32Array(n);
    const fars = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      times[i] = Math.max(0, b.timeSampling.getSampleTime(i) - startOffset);
      const samp = b.cameraSchema.getSample(i);
      fovs[i] = computeVerticalFovDeg(samp);
      focuses[i] = samp.focusDistance;
      nears[i] = Math.max(1e-4, samp.nearClippingPlane);
      fars[i] = Math.max(nears[i]! + 1, samp.farClippingPlane);
    }

    tracks.push(new THREE.NumberKeyframeTrack(`${trackTarget}.fov`, times, fovs));
    tracks.push(new THREE.NumberKeyframeTrack(`${trackTarget}.focus`, times, focuses));
    tracks.push(new THREE.NumberKeyframeTrack(`${trackTarget}.near`, times, nears));
    tracks.push(new THREE.NumberKeyframeTrack(`${trackTarget}.far`, times, fars));
  }

  // 4. Homogeneous Mesh MorphTarget tracks
  if (includeMorphs) {
    for (const b of controller.homogeneousMeshBindings) {
      const totalSamples = b.numSamples;
      if (totalSamples <= 1) continue;

      const step = Math.max(1, Math.ceil(totalSamples / Math.max(2, maxMorphFrames)));
      const sampleIndices: number[] = [];
      for (let i = 0; i < totalSamples; i += step) {
        sampleIndices.push(i);
      }
      if (sampleIndices[sampleIndices.length - 1] !== totalSamples - 1) {
        sampleIndices.push(totalSamples - 1);
      }

      const initial = b.evaluator.getInitialMesh(true);
      const basePositions = initial.positions;

      // Sample frames >= 1 as relative or absolute morph targets (Three.js defaults morphTargetsRelative = false)
      const morphTargets: THREE.BufferAttribute[] = [];
      const sampleTimes = sampleIndices.map((sIdx) =>
        Math.max(0, b.timeSampling.getSampleTime(sIdx) - startOffset)
      );

      // Reset geometry base position to frame 0 so influence=0 equals sample 0
      for (const geom of b.geometries) {
        const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
        if (posAttr && posAttr.array.length === basePositions.length) {
          (posAttr.array as Float32Array).set(basePositions);
          posAttr.needsUpdate = true;
        }
      }

      for (let k = 1; k < sampleIndices.length; k++) {
        const t = b.timeSampling.getSampleTime(sampleIndices[k]!);
        const evalRes = b.evaluator.evaluateAtTime(t, { interpolate: false, copy: true });
        const attr = new THREE.BufferAttribute(evalRes.positions, 3);
        attr.name = `frame_${sampleIndices[k]}`;
        morphTargets.push(attr);
      }

      if (morphTargets.length === 0) continue;

      for (const geom of b.geometries) {
        geom.morphTargetsRelative = false;
        geom.morphAttributes.position = morphTargets;

        // Find all Mesh instances in controller.root using this geometry
        controller.root.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).geometry === geom) {
            const mesh = obj as THREE.Mesh;
            mesh.updateMorphTargets();
            const meshUuid = ensureTrackUuid(mesh);

            // Sparse 3-keyframe hat function per morph target instead of dense O(N^2) matrix!
            for (let m = 0; m < morphTargets.length; m++) {
              const kIdx = m + 1; // corresponds to sampleTimes[kIdx]
              const keyTimes: number[] = [];
              const keyValues: number[] = [];

              if (kIdx - 1 >= 0) {
                keyTimes.push(sampleTimes[kIdx - 1]!);
                keyValues.push(0);
              }
              keyTimes.push(sampleTimes[kIdx]!);
              keyValues.push(1);
              if (kIdx + 1 < sampleTimes.length) {
                keyTimes.push(sampleTimes[kIdx + 1]!);
                keyValues.push(0);
              }

              tracks.push(
                new THREE.NumberKeyframeTrack(
                  `${meshUuid}.morphTargetInfluences[${m}]`,
                  keyTimes,
                  keyValues
                )
              );
            }
          }
        });
      }
    }
  }

  return new THREE.AnimationClip(clipName, controller.duration || -1, tracks);
}

function ensureTrackUuid(obj: THREE.Object3D): string {
  return obj.uuid;
}
