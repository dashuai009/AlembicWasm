import * as THREE from "three";
import {
  IArchive,
  ICamera,
  ICollections,
  ICompoundProperty,
  ICurves,
  ILight,
  IMaterial,
  INuPatch,
  IObject,
  IPoints,
  IPolyMesh,
  ISubD,
  IXform,
  TopologyVariance,
  openArchive,
  type ArchiveSource,
  type DrawGroup,
  type InitAlembicOptions,
  type RenderMeshData,
} from "../index.js";
import { extractABCCurvesFromSample } from "./ABCCurve.js";
import {
  AlembicSceneController,
  applyAlembicMatrixToObject3D,
  applyCameraSampleToThree,
  applyRenderMeshToGeometry,
} from "./AlembicSceneController.js";
import {
  buildThreeMaterialFromPbr,
  extractPbrParamsFromFlattened,
  extractPbrParamsFromIMaterial,
} from "./materials.js";

export interface ABCLoaderOptions {
  /** Custom initialization options for `alembic-wasm` (e.g., `wasmUrl` or `wasmBinary`). */
  wasmOptions?: InitAlembicOptions;
  /** Subdivision surface refinement level for `ISubD` schemas (default `1`). */
  subdLevel?: number;
  /** Segments evaluated per spline span for `ICurves` schemas (default `8`). */
  curveSegmentsPerSpan?: number;
  /** U tessellation segments for `INuPatch` schemas (default `16`). */
  nuPatchUSegments?: number;
  /** V tessellation segments for `INuPatch` schemas (default `16`). */
  nuPatchVSegments?: number;
  /** Compute flat per-triangle normals instead of smooth normals when normals are unauthored (default `false`). */
  flatNormals?: boolean;
  /** Render loaded mesh materials double-sided by default (default `false`). */
  doubleSided?: boolean;
  /** Default point size in world units for `IPoints` schemas (default `0.04`). */
  pointSize?: number;
  /** Default curve color for `ICurves` schemas (default `0xd4a359`). */
  lineColor?: THREE.ColorRepresentation;
  /** Optional override fallback `THREE.Material` when an object has no Alembic material assignment. */
  defaultMaterial?: THREE.Material;
  /** Preserve existing camera aspect instead of applying Alembic aperture aspect (default `false`). */
  preserveCameraAspect?: boolean;
  /** Attach evaluated `ABCCurve[]` instances onto `lineSegments.userData.abcCurves` (default `true`). */
  storeABCCurvesInUserData?: boolean;
}

interface BuildContext {
  archive: IArchive;
  controller: AlembicSceneController;
  options: Required<
    Omit<ABCLoaderOptions, "wasmOptions" | "defaultMaterial">
  > & {
    defaultMaterial?: THREE.Material;
  };
  geometryCache: Map<string, THREE.BufferGeometry>;
  materialCache: Map<string, THREE.Material>;
  collections: Record<string, string[]>;
}

/**
 * Full-featured Three.js loader for Alembic (`.abc`) Ogawa archives.
 *
 * Supports `Xform` (including shear & non-inherited transforms), `PolyMesh` (constant, homogeneous
 * sub-frame interpolated, and heterogeneous fluid topologies), `SubD`, `NuPatch`, `FaceSet`
 * multi-material draw groups, `Camera` (exact vertical aperture FOV), `Curves` (linear, Bezier,
 * B-Spline, Catmull-Rom, rational NURBS), `Points` (with color/width/velocity), `Light`,
 * `Material` (`IMaterial` & `MaterialFlatten`), `Collections`, `Visibility`, and instancing.
 *
 * Calling `load` / `loadAsync` / `parseAsync` attaches the live `AlembicSceneController` onto
 * `group.userData.alembicController` for arbitrary-time playback (`controller.update(dt)` /
 * `controller.setTime(t)`) or `controller.toAnimationClip()`.
 */
export class ABCLoader extends THREE.Loader<THREE.Group> {
  options: ABCLoaderOptions;

  constructor(manager?: THREE.LoadingManager, options?: ABCLoaderOptions) {
    super(manager);
    this.options = { ...options };
  }

  setOptions(options: Partial<ABCLoaderOptions>): this {
    this.options = { ...this.options, ...options };
    return this;
  }

  override load(
    url: string,
    onLoad: (data: THREE.Group) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void
  ): void {
    this.loadAsync(url, onProgress).then(onLoad, (err) => {
      if (onError) {
        onError(err);
      } else {
        console.error("[ABCLoader] Failed to load Alembic archive:", err);
      }
    });
  }

  override async loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<THREE.Group> {
    const controller = await this.loadWithControllerAsync(url, onProgress);
    return controller.root;
  }

  async parseAsync(source: ArchiveSource): Promise<THREE.Group> {
    const controller = await this.parseWithControllerAsync(source);
    return controller.root;
  }

  async loadWithControllerAsync(
    sourceOrUrl: string | ArchiveSource,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<AlembicSceneController> {
    if (typeof sourceOrUrl === "string") {
      const fileLoader = new THREE.FileLoader(this.manager);
      fileLoader.setPath(this.path);
      fileLoader.setResponseType("arraybuffer");
      fileLoader.setRequestHeader(this.requestHeader);
      fileLoader.setWithCredentials(this.withCredentials);

      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        fileLoader.load(
          sourceOrUrl,
          (data) => {
            if (data instanceof ArrayBuffer) {
              resolve(data);
            } else {
              const enc = new TextEncoder().encode(String(data));
              resolve(enc.buffer);
            }
          },
          onProgress,
          reject
        );
      });
      return this.parseWithControllerAsync(buffer);
    }
    return this.parseWithControllerAsync(sourceOrUrl);
  }

  async parseWithControllerAsync(source: ArchiveSource): Promise<AlembicSceneController> {
    const archive = await openArchive(source, this.options.wasmOptions);

    const root = new THREE.Group();
    const top = archive.top;
    root.name = top.name || "ABC";

    const controller = new AlembicSceneController({
      archive,
      root,
      cameras: [],
    });

    const ctx: BuildContext = {
      archive,
      controller,
      options: {
        subdLevel: this.options.subdLevel ?? 1,
        curveSegmentsPerSpan: this.options.curveSegmentsPerSpan ?? 8,
        nuPatchUSegments: this.options.nuPatchUSegments ?? 16,
        nuPatchVSegments: this.options.nuPatchVSegments ?? 16,
        flatNormals: this.options.flatNormals ?? false,
        doubleSided: this.options.doubleSided ?? false,
        pointSize: this.options.pointSize ?? 0.04,
        lineColor: this.options.lineColor ?? 0xd4a359,
        preserveCameraAspect: this.options.preserveCameraAspect ?? false,
        storeABCCurvesInUserData: this.options.storeABCCurvesInUserData ?? true,
        defaultMaterial: this.options.defaultMaterial,
      },
      geometryCache: new Map(),
      materialCache: new Map(),
      collections: {},
    };

    const children = top.children();
    for (const child of children) {
      this.buildNode(child, root, ctx, null);
    }

    controller.finalizeTimeMetrics();
    if (controller.isAnimated) {
      controller.setTime(controller.startTime);
    }

    root.userData.alembicController = controller;
    root.userData.alembicCameras = controller.cameras;
    root.userData.alembicArchiveInfo = archive.info;
    root.userData.alembicCollections = ctx.collections;

    return controller;
  }

  private buildNode(
    obj: IObject,
    parentThree: THREE.Object3D,
    ctx: BuildContext,
    instanceMapping: { instanceRootPath: string; sourceRootPath: string } | null
  ): void {
    let retainObjForVisibility = false;
    let activeMapping = instanceMapping;

    if (obj.isInstanceRoot) {
      activeMapping = {
        instanceRootPath: obj.fullName,
        sourceRootPath: obj.instanceSourcePath,
      };
    }

    const canonicalPath = activeMapping
      ? activeMapping.sourceRootPath + obj.fullName.slice(activeMapping.instanceRootPath.length)
      : obj.fullName;

    const schemaType = obj.schemaType;
    let createdNode: THREE.Object3D | null = null;

    switch (schemaType) {
      case "Xform": {
        createdNode = this.buildXformNode(obj, parentThree, ctx);
        break;
      }
      case "PolyMesh": {
        createdNode = this.buildPolyMeshNode(obj, canonicalPath, ctx);
        break;
      }
      case "SubD": {
        createdNode = this.buildSubDNode(obj, canonicalPath, ctx);
        break;
      }
      case "NuPatch": {
        createdNode = this.buildNuPatchNode(obj, canonicalPath, ctx);
        break;
      }
      case "Camera": {
        createdNode = this.buildCameraNode(obj, ctx);
        break;
      }
      case "Curves": {
        createdNode = this.buildCurvesNode(obj, canonicalPath, ctx);
        break;
      }
      case "Points": {
        createdNode = this.buildPointsNode(obj, canonicalPath, ctx);
        break;
      }
      case "Light": {
        createdNode = this.buildLightNode(obj, ctx);
        break;
      }
      case "Material": {
        // Pre-populate material cache by full path for fast assignment lookup
        const imat = new IMaterial(obj);
        try {
          const pbr = extractPbrParamsFromIMaterial(imat);
          ctx.materialCache.set(
            obj.fullName,
            buildThreeMaterialFromPbr(pbr, { doubleSided: ctx.options.doubleSided })
          );
        } finally {
          imat.dispose();
        }
        break;
      }
      case "Collections": {
        const icol = new ICollections(obj);
        try {
          for (const colName of icol.getCollectionNames()) {
            ctx.collections[colName] = icol.getPaths(colName);
          }
        } finally {
          icol.dispose();
        }
        break;
      }
      case "FaceSet": {
        // Consumed directly by parent PolyMesh / SubD draw group builder
        break;
      }
      default: {
        // Untyped grouping IObject
        const grp = new THREE.Group();
        grp.name = obj.name;
        createdNode = grp;
        break;
      }
    }

    if (createdNode) {
      createdNode.userData.alembicFullName = obj.fullName;
      createdNode.userData.alembicSchema = schemaType;
      if (obj.isInstanceRoot) {
        createdNode.userData.alembicInstanceSource = obj.instanceSourcePath;
      }

      parentThree.add(createdNode);

      // Visibility binding (static or animated)
      const visProp = obj.getVisibilityProperty();
      if (visProp) {
        const nVis = visProp.numSamples;
        const tsIdx = visProp.timeSamplingIndex;
        const isConstVis = visProp.isConstant;
        visProp.dispose();

        createdNode.visible = obj.isVisibleAt(0);
        if (!isConstVis && nVis > 1) {
          retainObjForVisibility = true;
          ctx.controller.visibilityBindings.push({
            object: obj,
            target: createdNode,
            timeSampling: ctx.archive.getTimeSampling(tsIdx),
            numSamples: nVis,
          });
        }
      }

      // Recurse into children (excluding FaceSet children which belong to parent mesh)
      const children = obj.children();
      for (const child of children) {
        if (child.schemaType === "FaceSet") {
          child.dispose();
          continue;
        }
        this.buildNode(child, createdNode, ctx, activeMapping);
      }
    } else if (schemaType === "Material" || schemaType === "Collections") {
      // Material / Collections containers may still hold nested materials
      const children = obj.children();
      for (const child of children) {
        this.buildNode(child, parentThree, ctx, activeMapping);
      }
    }

    if (!retainObjForVisibility) {
      obj.dispose();
    }
  }

  private buildXformNode(
    obj: IObject,
    parentThree: THREE.Object3D,
    ctx: BuildContext
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = obj.name;
    // Attach temporarily before applying matrix if `!inherits` needs parent world matrix
    parentThree.add(group);

    const xform = new IXform(obj);
    const numSamples = xform.numSamples;
    if (numSamples > 0) {
      const m16 = xform.getMatrix(0, false);
      const inherits = xform.getInheritsXforms(0);
      applyAlembicMatrixToObject3D(group, m16, inherits);
    }

    if (!xform.isConstant && numSamples > 1) {
      const ts = ctx.archive.getTimeSampling(xform.timeSamplingIndex);
      ctx.controller.xformBindings.push({
        xform,
        target: group,
        timeSampling: ts,
        numSamples,
      });
    } else {
      xform.dispose();
    }

    return group;
  }

  private buildPolyMeshNode(
    obj: IObject,
    canonicalPath: string,
    ctx: BuildContext
  ): THREE.Mesh {
    const cachedGeom = ctx.geometryCache.get(canonicalPath);
    const poly = new IPolyMesh(obj);

    if (cachedGeom) {
      const hasColors = Boolean(cachedGeom.getAttribute("color"));
      const mat = this.resolveMeshMaterials(obj, poly, [], hasColors, ctx);
      poly.dispose();
      const mesh = new THREE.Mesh(cachedGeom, mat);
      mesh.name = obj.name;
      return mesh;
    }

    const geom = new THREE.BufferGeometry();
    geom.name = obj.name;
    ctx.geometryCache.set(canonicalPath, geom);

    const variance = poly.topologyVariance;
    const numSamples = poly.numSamples;
    const isAnimated = !poly.isConstant && numSamples > 1;

    let initialData: RenderMeshData;
    if (isAnimated && variance !== TopologyVariance.Heterogeneous) {
      const evaluator = poly.createHomogeneousEvaluator({
        reverseWinding: true,
        flatNormals: ctx.options.flatNormals,
      });
      initialData = evaluator.getInitialMesh(true);
      applyRenderMeshToGeometry(geom, initialData);
      ctx.controller.homogeneousMeshBindings.push({
        polyMesh: poly,
        evaluator,
        geometries: [geom],
        timeSampling: ctx.archive.getTimeSampling(poly.timeSamplingIndex),
        numSamples,
      });
    } else if (isAnimated && variance === TopologyVariance.Heterogeneous) {
      initialData = poly.buildRenderMesh(0, {
        reverseWinding: true,
        flatNormals: ctx.options.flatNormals,
      });
      applyRenderMeshToGeometry(geom, initialData);
      ctx.controller.heterogeneousMeshBindings.push({
        polyMesh: poly,
        geometries: [geom],
        timeSampling: ctx.archive.getTimeSampling(poly.timeSamplingIndex),
        numSamples,
        flatNormals: ctx.options.flatNormals,
        lastSampleIndex: 0,
        lastAdvectDt: 0,
      });
    } else {
      initialData = poly.buildRenderMesh(0, {
        reverseWinding: true,
        flatNormals: ctx.options.flatNormals,
      });
      applyRenderMeshToGeometry(geom, initialData);
    }

    const hasColors = Boolean(initialData.colors && initialData.colors.length > 0);
    const material = this.resolveMeshMaterials(obj, poly, initialData.groups, hasColors, ctx);

    if (!isAnimated) {
      poly.dispose();
    }

    const mesh = new THREE.Mesh(geom, material);
    mesh.name = obj.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildSubDNode(
    obj: IObject,
    canonicalPath: string,
    ctx: BuildContext
  ): THREE.Mesh {
    const cachedGeom = ctx.geometryCache.get(canonicalPath);
    const subd = new ISubD(obj);

    if (cachedGeom) {
      const hasColors = Boolean(cachedGeom.getAttribute("color"));
      const mat = this.resolveObjectMaterial(obj, hasColors, ctx);
      subd.dispose();
      const mesh = new THREE.Mesh(cachedGeom, mat);
      mesh.name = obj.name;
      return mesh;
    }

    const geom = new THREE.BufferGeometry();
    geom.name = obj.name;
    ctx.geometryCache.set(canonicalPath, geom);

    const data = subd.buildRenderMesh(0, {
      subdLevel: ctx.options.subdLevel,
      reverseWinding: true,
    });
    applyRenderMeshToGeometry(geom, data);

    const hasColors = Boolean(data.colors && data.colors.length > 0);
    const material = this.resolveSubDMaterials(obj, subd, data.groups, hasColors, ctx);

    const numSamples = subd.numSamples;
    if (!subd.isConstant && numSamples > 1) {
      ctx.controller.subdBindings.push({
        subd,
        geometries: [geom],
        timeSampling: ctx.archive.getTimeSampling(subd.timeSamplingIndex),
        numSamples,
        subdLevel: ctx.options.subdLevel,
        lastSampleIndex: 0,
      });
    } else {
      subd.dispose();
    }

    const mesh = new THREE.Mesh(geom, material);
    mesh.name = obj.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildNuPatchNode(
    obj: IObject,
    canonicalPath: string,
    ctx: BuildContext
  ): THREE.Mesh {
    const cachedGeom = ctx.geometryCache.get(canonicalPath);
    const patch = new INuPatch(obj);

    if (cachedGeom) {
      const hasColors = Boolean(cachedGeom.getAttribute("color"));
      const mat = this.resolveObjectMaterial(obj, hasColors, ctx);
      patch.dispose();
      const mesh = new THREE.Mesh(cachedGeom, mat);
      mesh.name = obj.name;
      return mesh;
    }

    const geom = new THREE.BufferGeometry();
    geom.name = obj.name;
    ctx.geometryCache.set(canonicalPath, geom);

    const data = patch.buildRenderMesh(0, {
      uSegments: ctx.options.nuPatchUSegments,
      vSegments: ctx.options.nuPatchVSegments,
      reverseWinding: true,
    });
    applyRenderMeshToGeometry(geom, data);

    const hasColors = Boolean(data.colors && data.colors.length > 0);
    const material = this.resolveObjectMaterial(obj, hasColors, ctx);

    const numSamples = patch.numSamples;
    if (!patch.isConstant && numSamples > 1) {
      ctx.controller.nuPatchBindings.push({
        nuPatch: patch,
        geometries: [geom],
        timeSampling: ctx.archive.getTimeSampling(patch.timeSamplingIndex),
        numSamples,
        uSegments: ctx.options.nuPatchUSegments,
        vSegments: ctx.options.nuPatchVSegments,
        lastSampleIndex: 0,
      });
    } else {
      patch.dispose();
    }

    const mesh = new THREE.Mesh(geom, material);
    mesh.name = obj.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildCameraNode(obj: IObject, ctx: BuildContext): THREE.PerspectiveCamera {
    const camSchema = new ICamera(obj);
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 10000);
    cam.name = obj.name;

    const numSamples = camSchema.numSamples;
    if (numSamples > 0) {
      applyCameraSampleToThree(cam, camSchema.getSample(0), ctx.options.preserveCameraAspect);
    }

    ctx.controller.cameras.push(cam);

    if (!camSchema.isConstant && numSamples > 1) {
      ctx.controller.cameraBindings.push({
        cameraSchema: camSchema,
        camera: cam,
        timeSampling: ctx.archive.getTimeSampling(camSchema.timeSamplingIndex),
        numSamples,
        preserveAspect: ctx.options.preserveCameraAspect,
      });
    } else {
      camSchema.dispose();
    }

    return cam;
  }

  private buildCurvesNode(
    obj: IObject,
    canonicalPath: string,
    ctx: BuildContext
  ): THREE.LineSegments {
    const cachedGeom = ctx.geometryCache.get(canonicalPath);
    const curves = new ICurves(obj);

    const mat = new THREE.LineBasicMaterial({
      color: ctx.options.lineColor,
    });

    if (cachedGeom) {
      curves.dispose();
      const line = new THREE.LineSegments(cachedGeom, mat);
      line.name = obj.name;
      return line;
    }

    const geom = new THREE.BufferGeometry();
    geom.name = obj.name;
    ctx.geometryCache.set(canonicalPath, geom);

    const evaluated = curves.evaluateForRender(0, ctx.options.curveSegmentsPerSpan);
    geom.setAttribute("position", new THREE.BufferAttribute(evaluated.segmentPositions, 3));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    const line = new THREE.LineSegments(geom, mat);
    line.name = obj.name;

    if (ctx.options.storeABCCurvesInUserData && curves.numSamples > 0) {
      const samp0 = curves.getSample(0);
      line.userData.abcCurves = extractABCCurvesFromSample(samp0);
    }

    const numSamples = curves.numSamples;
    if (!curves.isConstant && numSamples > 1) {
      ctx.controller.curvesBindings.push({
        curves,
        geometries: [geom],
        timeSampling: ctx.archive.getTimeSampling(curves.timeSamplingIndex),
        numSamples,
        segmentsPerSpan: ctx.options.curveSegmentsPerSpan,
        lastSampleIndex: 0,
      });
    } else {
      curves.dispose();
    }

    return line;
  }

  private buildPointsNode(
    obj: IObject,
    canonicalPath: string,
    ctx: BuildContext
  ): THREE.Points {
    const cachedGeom = ctx.geometryCache.get(canonicalPath);
    const points = new IPoints(obj);

    if (cachedGeom) {
      const hasColors = Boolean(cachedGeom.getAttribute("color"));
      points.dispose();
      const pts = new THREE.Points(
        cachedGeom,
        new THREE.PointsMaterial({
          size: ctx.options.pointSize,
          vertexColors: hasColors,
          color: hasColors ? 0xffffff : 0x7ec8ff,
        })
      );
      pts.name = obj.name;
      return pts;
    }

    const geom = new THREE.BufferGeometry();
    geom.name = obj.name;
    ctx.geometryCache.set(canonicalPath, geom);

    let resolvedPointSize = ctx.options.pointSize;
    let hasVertexColors = false;

    if (points.numSamples > 0) {
      const samp0 = points.getSample(0);
      geom.setAttribute("position", new THREE.BufferAttribute(samp0.positions, 3));

      const widthsParam = points.getWidthsParam();
      if (widthsParam) {
        try {
          if (widthsParam.numSamples > 0) {
            const wVals = widthsParam.getExpandedSample(0);
            if (wVals instanceof Float32Array && wVals.length > 0) {
              geom.setAttribute("width", new THREE.BufferAttribute(wVals, 1));
              let sum = 0;
              for (let i = 0; i < wVals.length; i++) sum += wVals[i]!;
              const avg = sum / wVals.length;
              if (avg > 1e-5) resolvedPointSize = avg;
            }
          }
        } finally {
          widthsParam.dispose();
        }
      }

      const arb = points.getArbGeomParams();
      if (arb) {
        try {
          const colors = extractVertexColorsFromArb(
            arb,
            Math.floor(samp0.positions.length / 3)
          );
          if (colors) {
            geom.setAttribute("color", new THREE.BufferAttribute(colors.array, colors.itemSize));
            hasVertexColors = true;
          }
        } finally {
          arb.dispose();
        }
      }
      geom.computeBoundingBox();
      geom.computeBoundingSphere();
    }

    const numSamples = points.numSamples;
    if (!points.isConstant && numSamples > 1) {
      ctx.controller.pointsBindings.push({
        points,
        geometries: [geom],
        timeSampling: ctx.archive.getTimeSampling(points.timeSamplingIndex),
        numSamples,
        lastSampleIndex: 0,
      });
    } else {
      points.dispose();
    }

    const ptsMat = new THREE.PointsMaterial({
      size: resolvedPointSize,
      vertexColors: hasVertexColors,
      color: hasVertexColors ? 0xffffff : 0x7ec8ff,
      sizeAttenuation: true,
    });

    const ptsNode = new THREE.Points(geom, ptsMat);
    ptsNode.name = obj.name;
    return ptsNode;
  }

  private buildLightNode(obj: IObject, _ctx: BuildContext): THREE.Light {
    const lightSchema = new ILight(obj);
    try {
      let color = new THREE.Color(1, 1, 1);
      let intensity = 1.0;

      const flat = obj.flattenMaterial();
      try {
        const pbr = extractPbrParamsFromFlattened(flat);
        if (pbr) {
          color = new THREE.Color(pbr.color[0], pbr.color[1], pbr.color[2]);
        }
      } finally {
        flat.dispose();
      }

      const userProps = lightSchema.getUserProperties();
      if (userProps) {
        try {
          if (userProps.hasProperty("intensity")) {
            const s = userProps.getScalar("intensity");
            try {
              const v = s.getSample(0);
              if (v instanceof Float32Array || v instanceof Float64Array) {
                intensity = v[0] ?? 1.0;
              }
            } finally {
              s.dispose();
            }
          }
        } finally {
          userProps.dispose();
        }
      }

      const camSchema = lightSchema.getCameraSchema();
      if (camSchema) {
        try {
          if (camSchema.valid && camSchema.numSamples > 0) {
            const samp = camSchema.getSample(0);
            const spot = new THREE.SpotLight(color, intensity);
            spot.name = obj.name;
            spot.distance = samp.farClippingPlane > 0 ? samp.farClippingPlane : 0;
            return spot;
          }
        } finally {
          camSchema.dispose();
        }
      }

      const ptLight = new THREE.PointLight(color, intensity);
      ptLight.name = obj.name;
      return ptLight;
    } finally {
      lightSchema.dispose();
    }
  }

  private resolveObjectMaterial(
    obj: IObject,
    hasVertexColors: boolean,
    ctx: BuildContext
  ): THREE.Material {
    const assignedPath = obj.getMaterialAssignmentPath();
    if (assignedPath) {
      const cached = ctx.materialCache.get(assignedPath);
      if (cached && !hasVertexColors) {
        return cached;
      }
      const targetObj = ctx.archive.findObject(assignedPath);
      if (targetObj) {
        try {
          const imat = targetObj.asMaterial();
          if (imat) {
            try {
              const pbr = extractPbrParamsFromIMaterial(imat);
              const built = buildThreeMaterialFromPbr(pbr, {
                hasVertexColors,
                doubleSided: ctx.options.doubleSided,
              });
              if (!hasVertexColors) {
                ctx.materialCache.set(assignedPath, built);
              }
              return built;
            } finally {
              imat.dispose();
            }
          }
        } finally {
          targetObj.dispose();
        }
      }
    }

    const flat = obj.flattenMaterial();
    try {
      const pbr = extractPbrParamsFromFlattened(flat);
      if (pbr) {
        return buildThreeMaterialFromPbr(pbr, {
          hasVertexColors,
          doubleSided: ctx.options.doubleSided,
        });
      }
    } finally {
      flat.dispose();
    }

    if (ctx.options.defaultMaterial && !hasVertexColors) {
      return ctx.options.defaultMaterial;
    }

    return new THREE.MeshStandardMaterial({
      name: obj.name,
      color: hasVertexColors ? 0xffffff : 0xc6ccd6,
      roughness: 0.42,
      metalness: 0.08,
      vertexColors: hasVertexColors,
      side: ctx.options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
  }

  private resolveMeshMaterials(
    obj: IObject,
    poly: IPolyMesh,
    groups: DrawGroup[],
    hasVertexColors: boolean,
    ctx: BuildContext
  ): THREE.Material | THREE.Material[] {
    const baseMat = this.resolveObjectMaterial(obj, hasVertexColors, ctx);
    if (groups.length === 0) {
      return baseMat;
    }
    const maxIdx = Math.max(...groups.map((g) => g.materialIndex));
    const materials: THREE.Material[] = new Array(maxIdx + 1).fill(baseMat);

    for (const g of groups) {
      if (!g.faceSetName) {
        materials[g.materialIndex] = baseMat;
        continue;
      }
      const fs = poly.getFaceSet(g.faceSetName);
      if (!fs) continue;
      try {
        const fsObj = fs.object;
        try {
          materials[g.materialIndex] = this.resolveFaceSetMaterial(
            fsObj,
            g.faceSetName,
            g.materialIndex,
            baseMat,
            hasVertexColors,
            ctx
          );
        } finally {
          fsObj.dispose();
        }
      } finally {
        fs.dispose();
      }
    }
    return materials.length === 1 ? materials[0]! : materials;
  }

  private resolveSubDMaterials(
    obj: IObject,
    subd: ISubD,
    groups: DrawGroup[],
    hasVertexColors: boolean,
    ctx: BuildContext
  ): THREE.Material | THREE.Material[] {
    const baseMat = this.resolveObjectMaterial(obj, hasVertexColors, ctx);
    if (groups.length === 0) {
      return baseMat;
    }
    const maxIdx = Math.max(...groups.map((g) => g.materialIndex));
    const materials: THREE.Material[] = new Array(maxIdx + 1).fill(baseMat);

    for (const g of groups) {
      if (!g.faceSetName) {
        materials[g.materialIndex] = baseMat;
        continue;
      }
      const fs = subd.getFaceSet(g.faceSetName);
      if (!fs) continue;
      try {
        const fsObj = fs.object;
        try {
          materials[g.materialIndex] = this.resolveFaceSetMaterial(
            fsObj,
            g.faceSetName,
            g.materialIndex,
            baseMat,
            hasVertexColors,
            ctx
          );
        } finally {
          fsObj.dispose();
        }
      } finally {
        fs.dispose();
      }
    }
    return materials.length === 1 ? materials[0]! : materials;
  }

  private resolveFaceSetMaterial(
    fsObj: IObject,
    faceSetName: string,
    groupIndex: number,
    fallback: THREE.Material,
    hasVertexColors: boolean,
    ctx: BuildContext
  ): THREE.Material {
    const assignedPath = fsObj.getMaterialAssignmentPath();
    if (assignedPath) {
      return this.resolveObjectMaterial(fsObj, hasVertexColors, ctx);
    }
    const flat = fsObj.flattenMaterial();
    try {
      const pbr = extractPbrParamsFromFlattened(flat);
      if (pbr) {
        pbr.name = faceSetName;
        return buildThreeMaterialFromPbr(pbr, {
          hasVertexColors,
          doubleSided: ctx.options.doubleSided,
        });
      }
    } finally {
      flat.dispose();
    }

    // Distinct deterministic tint per FaceSet when no explicit material was bound
    const hslHue = ((groupIndex * 0.27) % 1 + 1) % 1;
    const tinted = new THREE.MeshStandardMaterial({
      name: faceSetName,
      color: new THREE.Color().setHSL(hslHue, 0.45, 0.58),
      roughness: (fallback as THREE.MeshStandardMaterial).roughness ?? 0.45,
      metalness: (fallback as THREE.MeshStandardMaterial).metalness ?? 0.08,
      vertexColors: hasVertexColors,
      side: ctx.options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    return tinted;
  }
}

function extractVertexColorsFromArb(
  arb: ICompoundProperty,
  expectedVertexCount: number
): { array: Float32Array; itemSize: 3 | 4 } | null {
  for (const name of ["Cd", "Cs", "color", "displayColor", "rgba"]) {
    if (!arb.hasProperty(name)) continue;
    const gp = arb.getGeomParam(name);
    if (!gp) continue;
    try {
      if (gp.numSamples === 0) continue;
      const ext = gp.dataType.extent;
      if (ext !== 3 && ext !== 4) continue;
      const vals = gp.getExpandedSample(0);
      if (vals instanceof Float32Array && vals.length >= expectedVertexCount * ext) {
        return {
          array: vals.slice(0, expectedVertexCount * ext),
          itemSize: ext as 3 | 4,
        };
      }
    } finally {
      gp.dispose();
    }
  }
  return null;
}
