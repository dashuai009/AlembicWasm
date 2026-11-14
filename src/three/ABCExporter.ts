import * as THREE from "three";
import {
  CurvePeriodicity,
  CurveType,
  GeometryScope,
  OObject,
  OPolyMesh,
  OXform,
  ObjectVisibility,
  PlainOldDataType,
  createArchive,
  type CameraSampleInput,
  type InitAlembicOptions,
} from "../index.js";
import { writeThreeMaterialToOMaterial } from "./materials.js";

export interface ABCExportFrameRange {
  startTime: number;
  endTime: number;
  fps?: number;
}

export interface ABCExportOptions {
  /** Archive metadata application string. */
  appName?: string;
  /** Archive metadata user description. */
  description?: string;
  /** Frames per second for animated exports (default `24`). */
  fps?: number;
  /** Optional `AnimationClip`s to play through `THREE.AnimationMixer` and bake into the archive. */
  clips?: THREE.AnimationClip[];
  /** Explicit frame range when exporting procedural or callback-driven animations. */
  frameRange?: ABCExportFrameRange;
  /** Custom per-frame callback invoked before sampling each frame `(timeSeconds, frameIndex)`. */
  evaluateFrame?: (timeSeconds: number, frameIndex: number) => void | Promise<void>;
  /** Export `THREE.Material`s as `OMaterial` (`UsdPreviewSurface`) and bind assignments (default `true`). */
  exportMaterials?: boolean;
  /**
   * Whether to sample mesh vertex positions at every frame during animated exports.
   * Defaults to `"auto"` (samples every frame for meshes with morph targets or skinning, static otherwise).
   */
  sampleDeformingMeshes?: "auto" | boolean | Set<THREE.Mesh>;
  /** Custom WASM initialization options. */
  wasmOptions?: InitAlembicOptions;
}

interface ExportRecorder {
  sampleFrame(frameIndex: number, timeSeconds: number): void;
  dispose(): void;
}

/**
 * Exports a `THREE.Object3D` scene hierarchy (static or animated) to an Ogawa `.abc` binary (`Uint8Array`).
 *
 * Supports:
 * - Hierarchical transforms (`OXform`, preserving shear, scale, rotation, translation)
 * - `THREE.Mesh` & `THREE.SkinnedMesh` -> `OPolyMesh` (automatic CCW -> CW winding flip, UVs, Normals, Vertex Colors, multi-material `OFaceSet` draw groups, MorphTarget & Skinned deformation baking)
 * - `THREE.InstancedMesh` -> prototype `OPolyMesh` + `OXform` instances via `addChildInstance`
 * - `THREE.PerspectiveCamera` -> `OCamera` (accurate focal length, vertical/horizontal aperture, film offset, focus, clip planes)
 * - `THREE.Points` -> `OPoints` (positions, sequential 64-bit IDs, widths, vertex colors)
 * - `THREE.Line` / `THREE.LineLoop` / `THREE.LineSegments` -> `OCurves`
 * - `THREE.Material` -> `OMaterial` (`UsdPreviewSurface` PBR parameters + `assignMaterial`)
 */
export class ABCExporter {
  async parseAsync(
    root: THREE.Object3D,
    options?: ABCExportOptions
  ): Promise<Uint8Array> {
    const fps = options?.frameRange?.fps ?? options?.fps ?? 24;
    const clips = options?.clips ?? [];

    let startTime = 0;
    let endTime = 0;
    let isAnimated = false;

    if (options?.frameRange) {
      startTime = options.frameRange.startTime;
      endTime = options.frameRange.endTime;
      isAnimated = endTime > startTime + 1e-7;
    } else if (clips.length > 0) {
      let maxDur = 0;
      for (const clip of clips) {
        if (clip.duration > maxDur) maxDur = clip.duration;
      }
      startTime = 0;
      endTime = maxDur;
      isAnimated = maxDur > 1e-7;
    }

    if (options?.evaluateFrame && !options.frameRange && clips.length === 0) {
      endTime = 1.0;
      isAnimated = true;
    }

    const archive = await createArchive({
      ...options?.wasmOptions,
      appName: options?.appName ?? "alembic-wasm/three ABCExporter",
      userDescription: options?.description ?? "Exported from Three.js via alembic-wasm",
      dccFps: fps,
    });

    try {
      const animTsIndex = isAnimated
        ? archive.addUniformTimeSampling(fps, { isFps: true, startTime })
        : 0;

      const top = archive.top;
      const recorders: ExportRecorder[] = [];
      const exportedMaterials = new Map<THREE.Material, string>();
      let materialsContainer: OObject | null = null;
      let materialsContainerName = "materials";

      const usedSiblingNames = new Map<OObject, Set<string>>();
      const makeUniqueChildName = (parent: OObject, desired: string): string => {
        let set = usedSiblingNames.get(parent);
        if (!set) {
          set = new Set();
          usedSiblingNames.set(parent, set);
        }
        let candidate = desired || "node";
        let suffix = 1;
        while (set.has(candidate)) {
          candidate = `${desired}_${suffix++}`;
        }
        set.add(candidate);
        return candidate;
      };

      const ensureMaterialPath = (mat: THREE.Material | undefined | null): string | null => {
        if (!mat || options?.exportMaterials === false) {
          return null;
        }
        const existing = exportedMaterials.get(mat);
        if (existing) {
          return existing;
        }
        if (!materialsContainer) {
          materialsContainerName = makeUniqueChildName(top, "materials");
          materialsContainer = top.addChild(materialsContainerName);
        }
        const safeBase = sanitizeAlembicName(mat.name || `mat_${exportedMaterials.size}`);
        const uniqueName = makeUniqueChildName(materialsContainer, safeBase);
        const omat = materialsContainer.addMaterial(uniqueName);
        try {
          writeThreeMaterialToOMaterial(mat, omat, 0);
          const omatObj = omat.object;
          const fullPath = omatObj
            ? omatObj.fullName
            : `/${materialsContainerName}/${uniqueName}`;
          omatObj?.dispose();
          exportedMaterials.set(mat, fullPath);
          return fullPath;
        } finally {
          omat.dispose();
        }
      };

      // Traverse scene hierarchy and create writer nodes
      const buildHierarchy = (
        node: THREE.Object3D,
        parentAbc: OObject,
        skipRootTransform: boolean
      ): void => {
        // Skip empty material-library container groups left from ABCLoader (`alembicSchema === "None"`)
        if (
          !skipRootTransform &&
          node.children.length === 0 &&
          node.type === "Group" &&
          node.userData?.alembicSchema === "None" &&
          node.name === "materials"
        ) {
          return;
        }
        // If `root` is a pure scene/group wrapper with identity transform and multiple children,
        // export its children directly or preserve its node cleanly.
        let currentAbcParent = parentAbc;
        let xformHandle: OXform | null = null;
        let xformObj: OObject | null = null;

        if (!skipRootTransform) {
          const xformName = makeUniqueChildName(
            parentAbc,
            sanitizeAlembicName(node.name || defaultNodeTypeName(node))
          );
          xformHandle = parentAbc.addXform(xformName, {
            timeSamplingIndex: animTsIndex,
          });
          xformObj = xformHandle.object;
          currentAbcParent = xformObj;

          const capturedXform = xformHandle;
          const capturedObj = xformObj;
          let lastVisible: boolean | null = null;

          recorders.push({
            sampleFrame: (frameIdx) => {
              if (node.matrixAutoUpdate) {
                node.updateMatrix();
              }
              if (frameIdx === 0 || isAnimated) {
                capturedXform.setMatrixSample(node.matrix.elements, true);
              }
              if (!node.visible && lastVisible !== false) {
                capturedObj.setVisibility(ObjectVisibility.Hidden, animTsIndex);
                lastVisible = false;
              } else if (node.visible && lastVisible === false) {
                capturedObj.setVisibility(ObjectVisibility.Visible, animTsIndex);
                lastVisible = true;
              }
            },
            dispose: () => {
              capturedObj.dispose();
              capturedXform.dispose();
            },
          });
        }

        // Emit shape schema under `currentAbcParent`
        if ((node as THREE.InstancedMesh).isInstancedMesh) {
          this.setupInstancedMeshRecorder(
            node as THREE.InstancedMesh,
            currentAbcParent,
            animTsIndex,
            isAnimated,
            ensureMaterialPath,
            makeUniqueChildName,
            recorders
          );
        } else if ((node as THREE.Mesh).isMesh) {
          this.setupMeshRecorder(
            node as THREE.Mesh,
            currentAbcParent,
            animTsIndex,
            isAnimated,
            options?.sampleDeformingMeshes ?? "auto",
            ensureMaterialPath,
            makeUniqueChildName,
            recorders
          );
        } else if ((node as THREE.PerspectiveCamera).isPerspectiveCamera) {
          this.setupCameraRecorder(
            node as THREE.PerspectiveCamera,
            currentAbcParent,
            animTsIndex,
            isAnimated,
            makeUniqueChildName,
            recorders
          );
        } else if ((node as THREE.Points).isPoints) {
          this.setupPointsRecorder(
            node as THREE.Points,
            currentAbcParent,
            animTsIndex,
            isAnimated,
            makeUniqueChildName,
            recorders
          );
        } else if ((node as THREE.Line).isLine) {
          this.setupLineRecorder(
            node as THREE.Line,
            currentAbcParent,
            animTsIndex,
            isAnimated,
            makeUniqueChildName,
            recorders
          );
        }

        for (const child of node.children) {
          buildHierarchy(child, currentAbcParent, false);
        }
      };

      const isWrapperScene =
        (root.type === "Scene" || root.type === "Group") &&
        root.children.length > 0 &&
        isIdentityObjectTransform(root) &&
        !(root as unknown as THREE.Mesh).isMesh;

      buildHierarchy(root, top, isWrapperScene);

      // Step frames & sample all recorders
      let mixer: THREE.AnimationMixer | null = null;
      if (clips.length > 0) {
        mixer = new THREE.AnimationMixer(root);
        for (const clip of clips) {
          const action = mixer.clipAction(clip);
          action.reset().play();
        }
      }

      const numFrames = isAnimated
        ? Math.max(2, Math.round((endTime - startTime) * fps) + 1)
        : 1;

      for (let f = 0; f < numFrames; f++) {
        const t = isAnimated
          ? Math.min(endTime, startTime + f / fps)
          : startTime;

        if (mixer) {
          mixer.setTime(t);
        }
        if (options?.evaluateFrame) {
          await options.evaluateFrame(t, f);
        }
        root.updateMatrixWorld(true);

        for (const rec of recorders) {
          rec.sampleFrame(f, t);
        }
      }

      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
      }

      // Dispose handles in reverse order before finalizing Ogawa archive
      for (let i = recorders.length - 1; i >= 0; i--) {
        recorders[i]!.dispose();
      }
      if (materialsContainer) {
        (materialsContainer as OObject).dispose();
      }
      top.dispose();

      return archive.finalize();
    } finally {
      archive.dispose();
    }
  }

  private setupMeshRecorder(
    mesh: THREE.Mesh,
    parentAbc: OObject,
    animTsIndex: number,
    isAnimated: boolean,
    deformingPolicy: "auto" | boolean | Set<THREE.Mesh>,
    ensureMaterialPath: (mat: THREE.Material | undefined | null) => string | null,
    makeUniqueChildName: (parent: OObject, desired: string) => string,
    recorders: ExportRecorder[]
  ): void {
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count === 0) {
      return;
    }

    const hasMorphs = Boolean(
      mesh.morphTargetInfluences &&
        mesh.morphTargetInfluences.length > 0 &&
        geom.morphAttributes.position &&
        geom.morphAttributes.position.length > 0
    );
    const isSkinned = Boolean((mesh as THREE.SkinnedMesh).isSkinnedMesh);

    const sampleEveryFrame =
      isAnimated &&
      (deformingPolicy === true ||
        (deformingPolicy === "auto" && (hasMorphs || isSkinned)) ||
        (deformingPolicy instanceof Set && deformingPolicy.has(mesh)));

    const shapeName = makeUniqueChildName(
      parentAbc,
      sanitizeAlembicName(`${mesh.name || "mesh"}Shape`)
    );
    const opoly = parentAbc.addPolyMesh(shapeName, {
      timeSamplingIndex: sampleEveryFrame ? animTsIndex : 0,
    });
    const opolyObj = opoly.object;

    // Topology (CW reversed from Three.js CCW triangles)
    const { faceIndices, faceCounts } = buildCwTriangleTopology(geom, posAttr.count);

    // Optional vertex color GeomParam (`Cd`)
    const colorAttr = geom.getAttribute("color") as THREE.BufferAttribute | undefined;
    const arb = colorAttr ? opoly.getArbGeomParams() : null;
    const colorParam =
      arb && colorAttr
        ? arb.createGeomParam("Cd", {
            pod: PlainOldDataType.Float32,
            extent: colorAttr.itemSize === 4 ? 4 : 3,
            scope: GeometryScope.Vertex,
            interpretation: colorAttr.itemSize === 4 ? "rgba" : "rgb",
          })
        : null;

    // Materials & multi-material FaceSets
    const matArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const faceSets: Array<{ fs: ReturnType<OPolyMesh["createFaceSet"]>; obj: OObject }> = [];

    if (matArray.length === 1 || geom.groups.length === 0) {
      const matPath = ensureMaterialPath(matArray[0]);
      if (matPath) {
        opolyObj.assignMaterial(matPath);
      }
    } else {
      // Group triangle faces by distinct material so multi-group meshes (e.g., BoxGeometry)
      // sharing a Material produce one clean, uniquely-named OFaceSet per Material.
      const facesByMat = new Map<THREE.Material | null, number[]>();
      for (let gIdx = 0; gIdx < geom.groups.length; gIdx++) {
        const g = geom.groups[gIdx]!;
        const startFace = Math.floor(g.start / 3);
        const endFace = Math.floor((g.start + g.count) / 3);
        const mat = matArray[g.materialIndex ?? 0] ?? matArray[0] ?? null;
        let bucket = facesByMat.get(mat);
        if (!bucket) {
          bucket = [];
          facesByMat.set(mat, bucket);
        }
        for (let f = startFace; f < endFace && f < faceCounts.length; f++) {
          bucket.push(f);
        }
      }

      const usedFsNames = new Set<string>();
      let groupCounter = 0;
      for (const [mat, faces] of facesByMat.entries()) {
        if (faces.length === 0) continue;
        const baseName = sanitizeAlembicName(mat?.name || `matGroup_${groupCounter++}`);
        let fsName = baseName;
        let suffix = 1;
        while (usedFsNames.has(fsName)) {
          fsName = `${baseName}_${suffix++}`;
        }
        usedFsNames.add(fsName);

        const ofs = opoly.createFaceSet(fsName);
        ofs.setFaces(Int32Array.from(faces));
        const ofsObj = ofs.object;
        const matPath = ensureMaterialPath(mat);
        if (matPath) {
          ofsObj.assignMaterial(matPath);
        }
        faceSets.push({ fs: ofs, obj: ofsObj });
      }
    }

    const uvAttr = geom.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const normAttr = geom.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const staticUVs = uvAttr ? extractFloatAttribute(uvAttr, 2) : undefined;
    const staticNormals = normAttr && !sampleEveryFrame ? extractFloatAttribute(normAttr, 3) : undefined;

    if (colorParam && colorAttr) {
      const cols = extractFloatAttribute(colorAttr, colorAttr.itemSize === 4 ? 4 : 3);
      colorParam.setSample(cols);
    }

    recorders.push({
      sampleFrame: (frameIdx) => {
        if (frameIdx > 0 && !sampleEveryFrame) {
          return;
        }
        const bakedPositions = extractDeformedMeshPositions(mesh, posAttr);
        opoly.setSample({
          positions: bakedPositions,
          faceIndices: frameIdx === 0 ? faceIndices : undefined,
          faceCounts: frameIdx === 0 ? faceCounts : undefined,
          uvs: frameIdx === 0 ? staticUVs : undefined,
          uvScope: GeometryScope.Vertex,
          normals: frameIdx === 0 ? staticNormals : undefined,
          normalScope: GeometryScope.Vertex,
        });
      },
      dispose: () => {
        for (const item of faceSets) {
          item.obj.dispose();
          item.fs.dispose();
        }
        colorParam?.dispose();
        arb?.dispose();
        opolyObj.dispose();
        opoly.dispose();
      },
    });
  }

  private setupInstancedMeshRecorder(
    instMesh: THREE.InstancedMesh,
    parentAbc: OObject,
    animTsIndex: number,
    isAnimated: boolean,
    ensureMaterialPath: (mat: THREE.Material | undefined | null) => string | null,
    makeUniqueChildName: (parent: OObject, desired: string) => string,
    recorders: ExportRecorder[]
  ): void {
    const geom = instMesh.geometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count === 0 || instMesh.count <= 0) {
      return;
    }

    // Create hidden prototype PolyMesh under this container, then add OXform instances referencing it
    const protoGroupName = makeUniqueChildName(parentAbc, "__prototype");
    const protoContainer = parentAbc.addChild(protoGroupName);
    protoContainer.setVisibility(ObjectVisibility.Hidden, 0);

    const protoMesh = protoContainer.addPolyMesh("protoShape", { timeSamplingIndex: 0 });
    const protoMeshObj = protoMesh.object;
    const { faceIndices, faceCounts } = buildCwTriangleTopology(geom, posAttr.count);
    const uvAttr = geom.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const normAttr = geom.getAttribute("normal") as THREE.BufferAttribute | undefined;

    protoMesh.setSample({
      positions: extractFloatAttribute(posAttr, 3),
      faceIndices,
      faceCounts,
      uvs: uvAttr ? extractFloatAttribute(uvAttr, 2) : undefined,
      uvScope: GeometryScope.Vertex,
      normals: normAttr ? extractFloatAttribute(normAttr, 3) : undefined,
      normalScope: GeometryScope.Vertex,
    });

    const singleMat = Array.isArray(instMesh.material)
      ? instMesh.material[0]
      : instMesh.material;
    const matPath = ensureMaterialPath(singleMat);
    if (matPath) {
      protoMeshObj.assignMaterial(matPath);
    }

    const instanceHandles: Array<{ xform: OXform; obj: OObject; index: number }> = [];
    const tmpMat = new THREE.Matrix4();

    for (let i = 0; i < instMesh.count; i++) {
      const ixName = makeUniqueChildName(parentAbc, `instance_${i}`);
      const ox = parentAbc.addXform(ixName, {
        timeSamplingIndex: isAnimated ? animTsIndex : 0,
      });
      const oxObj = ox.object;
      oxObj.addChildInstance(protoMeshObj, "shape");
      instanceHandles.push({ xform: ox, obj: oxObj, index: i });
    }

    recorders.push({
      sampleFrame: (frameIdx) => {
        if (frameIdx > 0 && !isAnimated) return;
        for (const item of instanceHandles) {
          instMesh.getMatrixAt(item.index, tmpMat);
          item.xform.setMatrixSample(tmpMat.elements, true);
        }
      },
      dispose: () => {
        for (let i = instanceHandles.length - 1; i >= 0; i--) {
          instanceHandles[i]!.obj.dispose();
          instanceHandles[i]!.xform.dispose();
        }
        protoMeshObj.dispose();
        protoMesh.dispose();
        protoContainer.dispose();
      },
    });
  }

  private setupCameraRecorder(
    cam: THREE.PerspectiveCamera,
    parentAbc: OObject,
    animTsIndex: number,
    isAnimated: boolean,
    makeUniqueChildName: (parent: OObject, desired: string) => string,
    recorders: ExportRecorder[]
  ): void {
    const camName = makeUniqueChildName(
      parentAbc,
      sanitizeAlembicName(`${cam.name || "camera"}Shape`)
    );
    const ocam = parentAbc.addCamera(camName, {
      timeSamplingIndex: isAnimated ? animTsIndex : 0,
    });

    recorders.push({
      sampleFrame: (frameIdx) => {
        if (frameIdx > 0 && !isAnimated) return;
        ocam.setSample(threeCameraToAlembicSample(cam));
      },
      dispose: () => {
        ocam.dispose();
      },
    });
  }

  private setupPointsRecorder(
    points: THREE.Points,
    parentAbc: OObject,
    animTsIndex: number,
    isAnimated: boolean,
    makeUniqueChildName: (parent: OObject, desired: string) => string,
    recorders: ExportRecorder[]
  ): void {
    const geom = points.geometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count === 0) return;

    const ptsName = makeUniqueChildName(
      parentAbc,
      sanitizeAlembicName(`${points.name || "points"}Shape`)
    );
    const opts = parentAbc.addPoints(ptsName, {
      timeSamplingIndex: isAnimated ? animTsIndex : 0,
    });

    const colorAttr = geom.getAttribute("color") as THREE.BufferAttribute | undefined;
    const arb = colorAttr ? opts.getArbGeomParams() : null;
    const colorParam =
      arb && colorAttr
        ? arb.createGeomParam("Cd", {
            pod: PlainOldDataType.Float32,
            extent: colorAttr.itemSize === 4 ? 4 : 3,
            scope: GeometryScope.Vertex,
            interpretation: colorAttr.itemSize === 4 ? "rgba" : "rgb",
          })
        : null;

    if (colorParam && colorAttr) {
      colorParam.setSample(
        extractFloatAttribute(colorAttr, colorAttr.itemSize === 4 ? 4 : 3)
      );
    }

    const ptsMat = points.material as THREE.PointsMaterial | undefined;
    const constantWidth =
      ptsMat && typeof ptsMat.size === "number" ? new Float32Array([ptsMat.size]) : undefined;

    recorders.push({
      sampleFrame: (frameIdx) => {
        if (frameIdx > 0 && !isAnimated) return;
        const p = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
        if (!p) return;
        const n = p.count;
        const ids = new BigUint64Array(n);
        for (let i = 0; i < n; i++) ids[i] = BigInt(i);
        opts.setSample({
          positions: extractFloatAttribute(p, 3),
          ids,
          widths: constantWidth,
          widthScope: GeometryScope.Constant,
        });
      },
      dispose: () => {
        colorParam?.dispose();
        arb?.dispose();
        opts.dispose();
      },
    });
  }

  private setupLineRecorder(
    line: THREE.Line,
    parentAbc: OObject,
    animTsIndex: number,
    isAnimated: boolean,
    makeUniqueChildName: (parent: OObject, desired: string) => string,
    recorders: ExportRecorder[]
  ): void {
    const geom = line.geometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count < 2) return;

    const curveName = makeUniqueChildName(
      parentAbc,
      sanitizeAlembicName(`${line.name || "curves"}Shape`)
    );
    const ocurves = parentAbc.addCurves(curveName, {
      timeSamplingIndex: isAnimated ? animTsIndex : 0,
    });

    const isSegments = Boolean((line as THREE.LineSegments).isLineSegments);
    const isLoop = Boolean((line as THREE.LineLoop).isLineLoop);

    recorders.push({
      sampleFrame: (frameIdx) => {
        if (frameIdx > 0 && !isAnimated) return;
        const p = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
        if (!p || p.count < 2) return;
        const positions = extractFloatAttribute(p, 3);
        let counts: Int32Array;
        if (isSegments) {
          const numPairs = Math.floor(p.count / 2);
          counts = new Int32Array(numPairs).fill(2);
        } else {
          counts = new Int32Array([p.count]);
        }
        ocurves.setSample({
          positions: isSegments ? positions.subarray(0, counts.length * 6) : positions,
          curvesNumVertices: counts,
          type: CurveType.Linear,
          wrap: isLoop ? CurvePeriodicity.Periodic : CurvePeriodicity.NonPeriodic,
        });
      },
      dispose: () => {
        ocurves.dispose();
      },
    });
  }
}

function threeCameraToAlembicSample(cam: THREE.PerspectiveCamera): CameraSampleInput {
  const aspect = cam.aspect > 0 ? cam.aspect : 16 / 9;
  const fovRad = (cam.fov * Math.PI) / 180;
  // Choose focalLength & apertures so both vertical FOV and aspect round-trip to 1e-7 accuracy
  const horizontalApertureCm = (cam.filmGauge > 0 ? cam.filmGauge : 36) / 10;
  const verticalApertureCm = horizontalApertureCm / aspect;
  const verticalApertureMm = verticalApertureCm * 10;
  const focalLengthMm =
    Math.tan(fovRad * 0.5) > 1e-8
      ? verticalApertureMm / (2 * Math.tan(fovRad * 0.5))
      : 35;

  return {
    focalLength: focalLengthMm,
    horizontalAperture: horizontalApertureCm,
    verticalAperture: verticalApertureCm,
    horizontalFilmOffset: (cam.filmOffset || 0) / 10,
    verticalFilmOffset: 0,
    lensSqueezeRatio: 1.0,
    focusDistance: cam.focus > 0 ? cam.focus : 5.0,
    fStop: 5.6,
    nearClippingPlane: Math.max(1e-4, cam.near),
    farClippingPlane: Math.max(cam.near + 1, cam.far),
  };
}

function buildCwTriangleTopology(
  geom: THREE.BufferGeometry,
  vertexCount: number
): { faceIndices: Int32Array; faceCounts: Int32Array } {
  const index = geom.getIndex();
  if (index) {
    const triCount = Math.floor(index.count / 3);
    const faceIndices = new Int32Array(triCount * 3);
    const faceCounts = new Int32Array(triCount).fill(3);
    for (let t = 0; t < triCount; t++) {
      const i0 = index.getX(t * 3);
      const i1 = index.getX(t * 3 + 1);
      const i2 = index.getX(t * 3 + 2);
      // CCW -> CW
      faceIndices[t * 3] = i0;
      faceIndices[t * 3 + 1] = i2;
      faceIndices[t * 3 + 2] = i1;
    }
    return { faceIndices, faceCounts };
  }

  const triCount = Math.floor(vertexCount / 3);
  const faceIndices = new Int32Array(triCount * 3);
  const faceCounts = new Int32Array(triCount).fill(3);
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    faceIndices[base] = base;
    faceIndices[base + 1] = base + 2;
    faceIndices[base + 2] = base + 1;
  }
  return { faceIndices, faceCounts };
}

function extractFloatAttribute(attr: THREE.BufferAttribute, components: number): Float32Array {
  if (
    attr.array instanceof Float32Array &&
    attr.itemSize === components &&
    !attr.normalized &&
    !(attr as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute
  ) {
    return new Float32Array(attr.array.subarray(0, attr.count * components));
  }
  const out = new Float32Array(attr.count * components);
  for (let i = 0; i < attr.count; i++) {
    out[i * components] = attr.getX(i);
    if (components >= 2) out[i * components + 1] = attr.getY(i);
    if (components >= 3) out[i * components + 2] = attr.getZ(i);
    if (components >= 4) out[i * components + 3] = attr.getW(i);
  }
  return out;
}

function extractDeformedMeshPositions(
  mesh: THREE.Mesh,
  posAttr: THREE.BufferAttribute
): Float32Array {
  const count = posAttr.count;
  const influences = mesh.morphTargetInfluences;
  const morphPos = mesh.geometry.morphAttributes.position;
  const isSkinned = Boolean((mesh as THREE.SkinnedMesh).isSkinnedMesh);

  if (!isSkinned && (!influences || !morphPos || morphPos.length === 0)) {
    return extractFloatAttribute(posAttr, 3);
  }

  const out = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const relative = mesh.geometry.morphTargetsRelative;

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(posAttr, i);

    if (influences && morphPos && morphPos.length > 0) {
      for (let m = 0; m < morphPos.length; m++) {
        const w = influences[m] ?? 0;
        if (Math.abs(w) < 1e-7) continue;
        tmp.fromBufferAttribute(morphPos[m]!, i);
        if (relative) {
          v.addScaledVector(tmp, w);
        } else {
          v.x += (tmp.x - posAttr.getX(i)) * w;
          v.y += (tmp.y - posAttr.getY(i)) * w;
          v.z += (tmp.z - posAttr.getZ(i)) * w;
        }
      }
    }

    if (isSkinned) {
      (mesh as THREE.SkinnedMesh).applyBoneTransform(i, v);
    }

    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

function sanitizeAlembicName(raw: string): string {
  const cleaned = raw.replace(/[\/\\]+/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "node";
}

function defaultNodeTypeName(node: THREE.Object3D): string {
  if ((node as THREE.Mesh).isMesh) return "mesh";
  if ((node as THREE.Camera).isCamera) return "camera";
  if ((node as THREE.Points).isPoints) return "points";
  if ((node as THREE.Line).isLine) return "curves";
  return "group";
}

function isIdentityObjectTransform(obj: THREE.Object3D): boolean {
  if (obj.matrixAutoUpdate) {
    obj.updateMatrix();
  }
  const e = obj.matrix.elements;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i++) {
    if (Math.abs(e[i]! - identity[i]!) > 1e-6) return false;
  }
  return true;
}
