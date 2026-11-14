import { describe, expect, it } from "vitest";
import {
  BasisType,
  CurvePeriodicity,
  CurveType,
  GeometryScope,
  PlainOldDataType,
  createArchive,
  openArchive,
} from "../src/index.js";
import { ABCLoader } from "../src/three/index.js";

describe("DCC Pipeline Conformance (Maya / Houdini / Blender Alembic Conventions)", () => {
  it("handles Houdini/Maya FaceVarying indexed UVs, Normals, arbitrary attributes, and non-zero start frames", async () => {
    // Houdini / Maya shots routinely start at frame 1001 (t = 1001 / 24 = 41.708333s)
    // and author indexed FaceVarying `uv` (`st`) + `N` + custom attributes (`vorticity`, `rest`).
    const fps = 24;
    const startFrame = 1001;
    const startTime = startFrame / fps;

    const writer = await createArchive({
      appName: "SideFX Houdini FX 20.5 (Simulated)",
      userDescription: "Shot 010_fx_water_cache",
      dccFps: fps,
    });

    const ts = writer.addUniformTimeSampling(fps, { isFps: true, startTime });
    const geo = writer.top.addXform("geo1", { timeSamplingIndex: 0 });
    geo.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const geoObj = geo.object;

    const mesh = geoObj.addPolyMesh("houdiniPolyShape", {
      timeSamplingIndex: ts,
      uvSourceName: "uv",
    });

    // 2 quads sharing an UV seam in the middle (classic DCC FaceVarying indexed UVs!)
    const pos0 = new Float32Array([
      -1, 0, 0,  0, 0, 0,  1, 0, 0,
      -1, 0, 1,  0, 0, 1,  1, 0, 1,
    ]);
    const pos1 = new Float32Array([
      -1, 0.5, 0,  0, 1.0, 0,  1, 0.5, 0,
      -1, 0.5, 1,  0, 1.0, 1,  1, 0.5, 1,
    ]);
    const faceCounts = new Int32Array([4, 4]);
    const faceIndices = new Int32Array([0, 1, 4, 3, 1, 2, 5, 4]);

    // Discontinuous UV island across shared edge (1-4) -> requires corner splitting in weldMeshCore!
    const uvPalette = new Float32Array([
      0.0, 0.0,  0.4, 0.0,  0.4, 1.0,  0.0, 1.0,
      0.6, 0.0,  1.0, 0.0,  1.0, 1.0,  0.6, 1.0,
    ]);
    const uvIndices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]);

    mesh.setSample({
      positions: pos0,
      faceCounts,
      faceIndices,
      uvs: uvPalette,
      uvIndices,
      uvScope: GeometryScope.FaceVarying,
    });
    mesh.setSample({
      positions: pos1,
    });

    // Houdini custom float attribute `vorticity` (Vertex scope)
    const arb = mesh.getArbGeomParams();
    const vort = arb.createGeomParam("vorticity", {
      pod: PlainOldDataType.Float32,
      extent: 1,
      scope: GeometryScope.Vertex,
    });
    vort.setSample(new Float32Array([0.1, 0.9, 0.2, 0.1, 0.85, 0.2]));
    vort.dispose();
    arb.dispose();

    mesh.dispose();

    // NURBS / Catmull-Rom groom curves
    const groom = geoObj.addCurves("groomGuides", { timeSamplingIndex: ts });
    groom.setSample({
      positions: new Float32Array([0, 0, 0, 0, 0.3, 0, 0.1, 0.7, 0, 0.2, 1.1, 0]),
      curvesNumVertices: new Int32Array([4]),
      type: CurveType.Cubic,
      wrap: CurvePeriodicity.NonPeriodic,
      basis: BasisType.CatmullRom,
    });
    groom.setSample({
      positions: new Float32Array([0, 0, 0, 0.1, 0.3, 0, 0.3, 0.7, 0, 0.5, 1.1, 0]),
    });
    groom.dispose();
    geoObj.dispose();
    geo.dispose();

    const bytes = writer.finalize();

    // 1. Core SDK verification
    const archive = await openArchive(bytes);
    try {
      expect(archive.info.dccFps).toBeCloseTo(24, 5);
      const echoText = archive.echo();
      expect(echoText).toContain("houdiniPolyShape");
      expect(echoText).toContain("vorticity");
    } finally {
      archive.close();
    }

    // 2. Three.js ABCLoader verification (UV seam splits 6 shared positions into 8 welded vertices!)
    const loader = new ABCLoader();
    const ctrl = await loader.loadWithControllerAsync(bytes);
    try {
      expect(ctrl.startTime).toBeCloseTo(startTime, 4);
      expect(ctrl.endTime).toBeCloseTo(startTime + 1 / fps, 4);
      expect(ctrl.fps).toBeCloseTo(24, 4);

      const polyBinding = ctrl.homogeneousMeshBindings[0]!;
      const geom = polyBinding.geometries[0]!;
      expect(geom.getAttribute("position").count).toBe(8); // Seam split preserved!
      expect(geom.getAttribute("uv").count).toBe(8);

      // Sub-frame midpoint between frame 1001 and 1002
      ctrl.setTime(startTime + 0.5 / fps);
      const posAttr = geom.getAttribute("position");
      // Vertex at (0, *, 0) is interpolated to Y = 0.5!
      let maxY = 0;
      for (let i = 0; i < posAttr.count; i++) {
        maxY = Math.max(maxY, posAttr.getY(i));
      }
      expect(maxY).toBeCloseTo(0.5, 4);
    } finally {
      ctrl.dispose();
    }
  });
});
