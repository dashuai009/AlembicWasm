import { describe, expect, it } from "vitest";
import {
  BasisType,
  CurvePeriodicity,
  CurveType,
  GeometryScope,
  ObjectVisibility,
  PlainOldDataType,
  TopologyVariance,
  XformOperationType,
  computeCameraAspect,
  computeVerticalFovDeg,
  createArchive,
  openArchive,
  openLayeredArchive,
  withLayerPrune,
  withLayerReplace,
} from "../src/index.js";

describe("All 11 AbcGeom / AbcMaterial / AbcCollection Schemas, Instancing, Visibility & Layering", () => {
  it("supports Xform op stacks, sub-frame matrix interpolation, Camera FOV, and Light schemas", async () => {
    const writer = await createArchive({ appName: "xform-cam-light", dccFps: 24 });
    const ts = writer.addUniformTimeSampling(10, { isFps: true, startTime: 0 }); // dt = 0.1s

    const xf = writer.top.addXform("rig", { timeSamplingIndex: ts });
    xf.setOpsSample([{ type: XformOperationType.Translate, channels: [0, 0, 0] }], true);
    xf.setOpsSample([{ type: XformOperationType.Translate, channels: [10, 20, -4] }], true);
    const xfObj = xf.object;

    const cam = xfObj.addCamera("camShape", { timeSamplingIndex: 0 });
    cam.setSample({
      focalLength: 50,
      horizontalAperture: 3.6,
      verticalAperture: 2.4,
      focusDistance: 8.5,
      fStop: 2.8,
      nearClippingPlane: 0.2,
      farClippingPlane: 500,
    });
    cam.dispose();

    const light = xfObj.addLight("keyLight", { timeSamplingIndex: 0 });
    light.setCameraSample({
      focalLength: 35,
      nearClippingPlane: 0.5,
      farClippingPlane: 120,
    });
    light.dispose();

    xfObj.dispose();
    xf.dispose();

    const bytes = writer.finalize();
    const reader = await openArchive(bytes);
    try {
      const rigObj = reader.findObject("/rig")!;
      const ixf = rigObj.asXform()!;
      expect(ixf.numSamples).toBe(2);

      // Midpoint at t = 0.05s should interpolate translation to (5, 10, -2)!
      const midMat = ixf.getInterpolatedMatrix(0.05);
      expect(midMat[12]).toBeCloseTo(5.0, 5);
      expect(midMat[13]).toBeCloseTo(10.0, 5);
      expect(midMat[14]).toBeCloseTo(-2.0, 5);
      ixf.dispose();
      rigObj.dispose();

      const camObj = reader.findObject("/rig/camShape")!;
      const icam = camObj.asCamera()!;
      const cs = icam.getSample(0);
      expect(cs.focalLength).toBeCloseTo(50, 5);
      expect(computeCameraAspect(cs)).toBeCloseTo(1.5, 5);
      const expectedFov = (2 * Math.atan(24 / 100) * 180) / Math.PI;
      expect(computeVerticalFovDeg(cs)).toBeCloseTo(expectedFov, 5);
      icam.dispose();
      camObj.dispose();

      const lightObj = reader.findObject("/rig/keyLight")!;
      const ilight = lightObj.asLight()!;
      const lcam = ilight.getCameraSchema()!;
      expect(lcam.getSample(0).farClippingPlane).toBeCloseTo(120, 4);
      lcam.dispose();
      ilight.dispose();
      lightObj.dispose();
    } finally {
      reader.close();
    }
  });

  it("supports PolyMesh homogeneous evaluator, FaceSet sorting/groups, SubD, Curves, Points, and NuPatch", async () => {
    const writer = await createArchive({ appName: "all-geoms", dccFps: 24 });
    const ts = writer.addUniformTimeSampling(10, { isFps: true, startTime: 0 }); // dt = 0.1s
    const top = writer.top;

    // 1. Homogeneous deforming PolyMesh with unsorted FaceSet indices
    const poly = top.addPolyMesh("deformingGrid", { timeSamplingIndex: ts });
    const fCounts = new Int32Array([4, 4]);
    const fIdx = new Int32Array([0, 1, 2, 3, 1, 4, 5, 2]);
    poly.setSample({
      positions: new Float32Array([
        0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1,  2, 0, 0,  2, 0, 1,
      ]),
      faceCounts: fCounts,
      faceIndices: fIdx,
      uvs: new Float32Array([0, 0, 0.5, 0, 0.5, 1, 0, 1, 1, 0, 1, 1]),
      uvScope: GeometryScope.Vertex,
    });
    poly.setSample({
      positions: new Float32Array([
        0, 2, 0,  1, 2, 0,  1, 2, 1,  0, 2, 1,  2, 2, 0,  2, 2, 1,
      ]),
    });
    const fs = poly.createFaceSet("unorderedSet");
    // Pass unsorted [1, 0] to verify C++ auto-sorting!
    fs.setFaces([1, 0]);
    fs.dispose();
    poly.dispose();

    // 2. SubD cube
    const subd = top.addSubD("subdCube");
    subd.setSample({
      positions: new Float32Array([
        -1, -1, -1,  1, -1, -1,  1,  1, -1, -1,  1, -1,
        -1, -1,  1,  1, -1,  1,  1,  1,  1, -1,  1,  1,
      ]),
      faceCounts: new Int32Array([4, 4, 4, 4, 4, 4]),
      faceIndices: new Int32Array([
        0, 1, 2, 3,  5, 4, 7, 6,  4, 0, 3, 7,
        1, 5, 6, 2,  3, 2, 6, 7,  4, 5, 1, 0,
      ]),
      subdivisionScheme: "catmull-clark",
    });
    subd.dispose();

    // 3. Cubic B-Spline Curves
    const curves = top.addCurves("hair");
    curves.setSample({
      positions: new Float32Array([
        0, 0, 0,  0, 1, 0,  0.5, 2, 0,  1, 3, 0,  1.5, 4, 0,
      ]),
      curvesNumVertices: new Int32Array([5]),
      type: CurveType.Cubic,
      wrap: CurvePeriodicity.NonPeriodic,
      basis: BasisType.BSpline,
      widths: new Float32Array([0.1, 0.08, 0.06, 0.04, 0.02]),
      widthScope: GeometryScope.Vertex,
    });
    curves.dispose();

    // 4. Points with auto/explicit 64-bit IDs
    const pts = top.addPoints("particles");
    pts.setSample({
      positions: new Float32Array([1, 2, 3, 4, 5, 6]),
      ids: new BigUint64Array([42n, 99n]),
      velocities: new Float32Array([0, 1, 0, 0, -1, 0]),
    });
    pts.dispose();

    // 5. Rational NuPatch
    const patch = top.addNuPatch("nurbsPatch");
    patch.setSample({
      positions: new Float32Array([
        0, 0, 0,  1, 0.5, 0,  2, 0, 0,
        0, 0.5, 1,  1, 1.5, 1,  2, 0.5, 1,
        0, 0, 2,  1, 0.5, 2,  2, 0, 2,
      ]),
      numU: 3,
      numV: 3,
      uOrder: 3,
      vOrder: 3,
      uKnot: new Float32Array([0, 0, 0, 1, 1, 1]),
      vKnot: new Float32Array([0, 0, 0, 1, 1, 1]),
      positionWeights: new Float32Array(9).fill(1.0),
    });
    patch.dispose();

    const bytes = writer.finalize();
    const reader = await openArchive(bytes);
    try {
      // Verify PolyMesh HomogeneousMeshEvaluator at t=0.05s -> Y=1.0!
      const polyObj = reader.findObject("/deformingGrid")!;
      const ipoly = polyObj.asPolyMesh()!;
      expect(ipoly.topologyVariance).toBe(TopologyVariance.Homogeneous);
      const ifs = ipoly.getFaceSet("unorderedSet")!;
      expect(Array.from(ifs.getFaces(0))).toEqual([0, 1]);
      ifs.dispose();

      const evaluator = ipoly.createHomogeneousEvaluator();
      const mid = evaluator.evaluateAtTime(0.05, { interpolate: true, copy: true });
      expect(mid.positions[1]).toBeCloseTo(1.0, 5);
      evaluator.dispose();
      ipoly.dispose();
      polyObj.dispose();

      // Verify SubD Catmull-Clark level 1 produces 24 quads -> 48 triangles (144 indices)
      const subdObj = reader.findObject("/subdCube")!;
      const isubd = subdObj.asSubD()!;
      const subdMesh = isubd.buildRenderMesh(0, { subdLevel: 1 });
      expect(subdMesh.indexCount).toBe(144);
      isubd.dispose();
      subdObj.dispose();

      // Verify Curves evaluation
      const curvesObj = reader.findObject("/hair")!;
      const icurves = curvesObj.asCurves()!;
      const evalC = icurves.evaluateForRender(0, 8);
      expect(evalC.segmentPositions.length).toBeGreaterThan(24);
      icurves.dispose();
      curvesObj.dispose();

      // Verify Points
      const ptsObj = reader.findObject("/particles")!;
      const ipts = ptsObj.asPoints()!;
      const ps = ipts.getSample(0);
      expect(Array.from(ps.ids)).toEqual([42n, 99n]);
      expect(Array.from(ps.velocities!)).toEqual([0, 1, 0, 0, -1, 0]);
      ipts.dispose();
      ptsObj.dispose();

      // Verify NuPatch tessellation
      const patchObj = reader.findObject("/nurbsPatch")!;
      const ipatch = patchObj.asNuPatch()!;
      const patchMesh = ipatch.buildRenderMesh(0, { uSegments: 8, vSegments: 8 });
      expect(patchMesh.vertexCount).toBe(81);
      expect(patchMesh.indexCount).toBe(8 * 8 * 6);
      ipatch.dispose();
      patchObj.dispose();
    } finally {
      reader.close();
    }
  });

  it("supports Materials (Shader Network + Flatten), Collections, Instancing, Visibility, and AbcCoreLayer", async () => {
    // Base archive
    const baseWriter = await createArchive({ appName: "base-layer" });
    const baseTop = baseWriter.top;

    const mats = baseTop.addChild("materials");
    const omat = mats.addMaterial("heroPbr");
    omat.setShader("arnold", "surface", "standard_surface");
    omat.addNetworkNode("texNode", "arnold", "image");
    omat.addNetworkNode("surfNode", "arnold", "standard_surface");
    omat.setNetworkNodeConnection("surfNode", "base_color", "texNode", "outColor");
    omat.setNetworkTerminal("arnold", "surface", "surfNode", "out");
    const surfParams = omat.getNetworkNodeParameters("surfNode");
    const roughProp = surfParams.createScalar("roughness", PlainOldDataType.Float32);
    roughProp.setSample(0.18);
    roughProp.dispose();
    surfParams.dispose();
    omat.dispose();
    mats.dispose();

    const proto = baseTop.addPolyMesh("protoMesh");
    proto.setSample({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      faceCounts: new Int32Array([3]),
      faceIndices: new Int32Array([0, 1, 2]),
    });
    const protoObj = proto.object;
    protoObj.assignMaterial("/materials/heroPbr");

    const instHolder = baseTop.addXform("inst1");
    const instHolderObj = instHolder.object;
    expect(instHolderObj.addChildInstance(protoObj, "instShape")).toBe(true);
    instHolderObj.setVisibility(ObjectVisibility.Hidden);
    instHolderObj.dispose();
    instHolder.dispose();

    const toPrune = baseTop.addChild("obsoleteNode");
    toPrune.dispose();

    const cols = baseTop.addCollections("sets");
    cols.createCollection("allRenderable", ["/protoMesh", "/inst1/instShape"]).dispose();
    cols.dispose();

    protoObj.dispose();
    proto.dispose();
    const baseBytes = baseWriter.finalize();

    // Override layer archive: prune `/obsoleteNode` and replace `/inst1` visibility!
    const layerWriter = await createArchive({ appName: "override-layer" });
    const pruned = layerWriter.top.addChild("obsoleteNode", withLayerPrune());
    pruned.dispose();
    const overrideInst = layerWriter.top.addXform("inst1", {
      metaData: withLayerReplace(),
    });
    const overrideInstObj = overrideInst.object;
    overrideInstObj.setVisibility(ObjectVisibility.Visible);
    overrideInstObj.dispose();
    overrideInst.dispose();
    const layerBytes = layerWriter.finalize();

    // Open merged layered archive!
    const layered = await openLayeredArchive([baseBytes, layerBytes]);
    try {
      expect(layered.findObject("/obsoleteNode")).toBeNull();

      const inst1 = layered.findObject("/inst1")!;
      expect(inst1.isVisibleAt(0)).toBe(true);
      inst1.dispose();

      // Verify material network & flatten on base archive
      const baseReader = await openArchive(baseBytes);
      try {
        const instShape = baseReader.findObject("/inst1/instShape")!;
        expect(instShape.isInstanceRoot).toBe(true);
        expect(instShape.instanceSourcePath).toBe("/protoMesh");
        expect(instShape.isVisibleAt(0)).toBe(false); // inherited Hidden from /inst1 in base!
        instShape.dispose();

        const pObj = baseReader.findObject("/protoMesh")!;
        expect(pObj.getMaterialAssignmentPath()).toBe("/materials/heroPbr");
        const flat = pObj.flattenMaterial();
        expect(flat.empty).toBe(false);
        expect(flat.numNetworkNodes).toBe(2);
        const term = flat.getNetworkTerminal("arnold", "surface");
        expect(term?.nodeName).toBe("surfNode");
        flat.dispose();
        pObj.dispose();

        const colObj = baseReader.findObject("/sets")!;
        const icol = colObj.asCollections()!;
        expect(icol.getPaths("allRenderable")).toEqual(["/protoMesh", "/inst1/instShape"]);
        icol.dispose();
        colObj.dispose();
      } finally {
        baseReader.close();
      }
    } finally {
      layered.close();
    }
  });
});
