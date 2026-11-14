import * as THREE from "three";
import {
  BasisType,
  CurvePeriodicity,
  CurveType,
  GeometryScope,
  ObjectVisibility,
  PlainOldDataType,
  XformOperationType,
  createArchive,
} from "alembic-wasm";

export const DEMO_PRESETS = [
  {
    id: "wave-surface",
    label: "1. Ocean Wave + Camera + FaceSets",
    description:
      "Homogeneous deforming PolyMesh (sub-frame C++ interpolated), two PBR materials assigned via FaceSets, vertex colors, custom metadata, Collections, and an animated orbiting Camera.",
  },
  {
    id: "fluid-splash",
    label: "2. Heterogeneous Fluid Splash",
    description:
      "Topology-varying PolyMesh where vertex & polygon counts change every frame, plus authored 3D velocity vectors (.velocities) for smooth sub-frame advection.",
  },
  {
    id: "curves-particles",
    label: "3. B-Spline Hair + Particle Fountain + SubD",
    description:
      "Catmull-Clark SubD emitter core with edge creases, 40 animated cubic B-Spline strands (ICurves), and 640 spiral particles (IPoints) with 64-bit IDs, widths, and RGB colors.",
  },
  {
    id: "robotic-instances",
    label: "4. Articulated Xform Ops + NuPatch + Instances",
    description:
      "Hierarchical Xform op stacks (turret/shoulder/elbow/wrist), rational NURBS dome (INuPatch), animated visibility beacon, and 12 radial instances sharing 1 prototype PolyMesh.",
  },
];

function writeUsdPreviewMaterial(omat, { diffuse, emissive = [0, 0, 0], roughness = 0.35, metallic = 0.1 }) {
  omat.setShader("universal", "surface", "UsdPreviewSurface");
  const params = omat.getShaderParameters("universal", "surface");
  try {
    const dc = params.createScalar("diffuseColor", PlainOldDataType.Float32, {
      extent: 3,
      interpretation: "rgb",
    });
    dc.setSample(diffuse);
    dc.dispose();

    const ec = params.createScalar("emissiveColor", PlainOldDataType.Float32, {
      extent: 3,
      interpretation: "rgb",
    });
    ec.setSample(emissive);
    ec.dispose();

    const r = params.createScalar("roughness", PlainOldDataType.Float32);
    r.setSample(roughness);
    r.dispose();

    const m = params.createScalar("metallic", PlainOldDataType.Float32);
    m.setSample(metallic);
    m.dispose();
  } finally {
    params.dispose();
  }
}

export async function generateProceduralAbc(presetId) {
  switch (presetId) {
    case "fluid-splash":
      return buildFluidSplashArchive();
    case "curves-particles":
      return buildCurvesAndParticlesArchive();
    case "robotic-instances":
      return buildRoboticInstancesArchive();
    case "wave-surface":
    default:
      return buildWaveSurfaceArchive();
  }
}

async function buildWaveSurfaceArchive() {
  const fps = 24;
  const frames = 72;
  const archive = await createArchive({
    appName: "alembic-wasm Procedural Studio",
    userDescription: "Homogeneous Wave PolyMesh + Orbiting Camera + PBR FaceSets",
    dccFps: fps,
  });

  try {
    const tsIdx = archive.addUniformTimeSampling(fps, { isFps: true, startTime: 0 });
    const top = archive.top;

    // 1. Author PBR Materials
    const matsGrp = top.addChild("materials");
    const oceanMat = matsGrp.addMaterial("oceanTeal");
    writeUsdPreviewMaterial(oceanMat, {
      diffuse: [0.09, 0.48, 0.68],
      roughness: 0.22,
      metallic: 0.12,
    });
    oceanMat.dispose();

    const crestMat = matsGrp.addMaterial("crestGold");
    writeUsdPreviewMaterial(crestMat, {
      diffuse: [0.92, 0.72, 0.34],
      emissive: [0.08, 0.05, 0.01],
      roughness: 0.28,
      metallic: 0.35,
    });
    crestMat.dispose();
    matsGrp.dispose();

    // 2. Deforming Wave PolyMesh
    const geoXform = top.addXform("waveRig", { timeSamplingIndex: 0 });
    geoXform.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const geoObj = geoXform.object;

    const poly = geoObj.addPolyMesh("oceanSurfaceShape", {
      timeSamplingIndex: tsIdx,
      uvSourceName: "st",
    });
    const polyObj = poly.object;
    polyObj.assignMaterial("/materials/oceanTeal");

    // Custom user property on mesh for Inspector demonstration
    const userProps = poly.getUserProperties();
    const solverProp = userProps.createScalar("solverName", PlainOldDataType.String);
    solverProp.setSample("Spectral Gerstner Wave v2.4");
    solverProp.dispose();
    const waveLenProp = userProps.createScalar("waveFrequency", PlainOldDataType.Float32);
    waveLenProp.setSample(1.85);
    waveLenProp.dispose();
    userProps.dispose();

    const nx = 36;
    const nz = 36;
    const size = 6.0;
    const numVerts = (nx + 1) * (nz + 1);
    const numQuads = nx * nz;

    const faceCounts = new Int32Array(numQuads).fill(4);
    const faceIndices = new Int32Array(numQuads * 4);
    const uvs = new Float32Array(numVerts * 2);
    const centerFaces = [];
    const outerFaces = [];

    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const v = iz * (nx + 1) + ix;
        uvs[v * 2] = ix / nx;
        uvs[v * 2 + 1] = iz / nz;
      }
    }

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const f = iz * nx + ix;
        const v00 = iz * (nx + 1) + ix;
        const v10 = v00 + 1;
        const v11 = v00 + (nx + 1) + 1;
        const v01 = v00 + (nx + 1);
        // CW quad from +Y
        faceIndices[f * 4] = v00;
        faceIndices[f * 4 + 1] = v10;
        faceIndices[f * 4 + 2] = v11;
        faceIndices[f * 4 + 3] = v01;

        const cx = (ix + 0.5) / nx - 0.5;
        const cz = (iz + 0.5) / nz - 0.5;
        if (Math.hypot(cx, cz) < 0.24) {
          centerFaces.push(f);
        } else {
          outerFaces.push(f);
        }
      }
    }

    // Two FaceSets with distinct materials
    const fsCrest = poly.createFaceSet("innerCrestZone");
    fsCrest.setFaces(Int32Array.from(centerFaces));
    const fsCrestObj = fsCrest.object;
    fsCrestObj.assignMaterial("/materials/crestGold");
    fsCrestObj.dispose();
    fsCrest.dispose();

    const fsOuter = poly.createFaceSet("outerSwellZone");
    fsOuter.setFaces(Int32Array.from(outerFaces));
    const fsOuterObj = fsOuter.object;
    fsOuterObj.assignMaterial("/materials/oceanTeal");
    fsOuterObj.dispose();
    fsOuter.dispose();

    // Vertex colors (Cd) static gradient
    const arb = poly.getArbGeomParams();
    const cdParam = arb.createGeomParam("Cd", {
      pod: PlainOldDataType.Float32,
      extent: 3,
      scope: GeometryScope.Vertex,
      interpretation: "rgb",
    });
    const colors = new Float32Array(numVerts * 3);
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const v = iz * (nx + 1) + ix;
        const rDist = Math.min(1, Math.hypot(ix / nx - 0.5, iz / nz - 0.5) * 1.8);
        colors[v * 3] = 1.0 - rDist * 0.25;
        colors[v * 3 + 1] = 0.95 - rDist * 0.1;
        colors[v * 3 + 2] = 0.88 + rDist * 0.12;
      }
    }
    cdParam.setSample(colors);
    cdParam.dispose();
    arb.dispose();

    const positions = new Float32Array(numVerts * 3);
    for (let frame = 0; frame < frames; frame++) {
      const phase = (frame / frames) * Math.PI * 2;
      for (let iz = 0; iz <= nz; iz++) {
        const z = (iz / nz - 0.5) * size;
        for (let ix = 0; ix <= nx; ix++) {
          const x = (ix / nx - 0.5) * size;
          const r = Math.hypot(x, z);
          const y =
            Math.sin(r * 2.4 - phase * 2.0) * 0.42 * Math.exp(-r * 0.22) +
            Math.cos(x * 1.4 + phase) * Math.sin(z * 1.4 - phase) * 0.16;
          const v = iz * (nx + 1) + ix;
          positions[v * 3] = x;
          positions[v * 3 + 1] = y;
          positions[v * 3 + 2] = z;
        }
      }
      poly.setSample({
        positions,
        faceIndices: frame === 0 ? faceIndices : undefined,
        faceCounts: frame === 0 ? faceCounts : undefined,
        uvs: frame === 0 ? uvs : undefined,
        uvScope: GeometryScope.Vertex,
      });
    }

    polyObj.dispose();
    poly.dispose();
    geoObj.dispose();
    geoXform.dispose();

    // 3. Animated Orbiting Camera
    const camRig = top.addXform("shotCamRig", { timeSamplingIndex: tsIdx });
    const camRigObj = camRig.object;
    const ocam = camRigObj.addCamera("shotCamShape", { timeSamplingIndex: tsIdx });

    const camMat = new THREE.Matrix4();
    const eye = new THREE.Vector3();
    const target = new THREE.Vector3(0, 0.1, 0);
    const up = new THREE.Vector3(0, 1, 0);

    for (let frame = 0; frame < frames; frame++) {
      const u = frame / frames;
      const angle = u * Math.PI * 2;
      const radius = 6.2 + Math.sin(angle * 2) * 0.6;
      eye.set(Math.sin(angle) * radius, 2.7 + Math.cos(angle) * 0.45, Math.cos(angle) * radius);
      camMat.lookAt(eye, target, up);
      camMat.setPosition(eye);
      camRig.setMatrixSample(camMat.elements, true);

      ocam.setSample({
        focalLength: 35 + Math.sin(angle) * 4,
        horizontalAperture: 3.6,
        verticalAperture: 2.025,
        focusDistance: eye.distanceTo(target),
        fStop: 4.0,
        nearClippingPlane: 0.1,
        farClippingPlane: 200,
      });
    }

    ocam.dispose();
    camRigObj.dispose();
    camRig.dispose();

    // 4. Collections
    const cols = top.addCollections("renderSets");
    const heroCol = cols.createCollection("heroAssets", [
      "/waveRig/oceanSurfaceShape",
      "/shotCamRig/shotCamShape",
    ]);
    heroCol.dispose();
    cols.dispose();

    return {
      fileName: "procedural_wave_surface.abc",
      bytes: archive.finalize(),
    };
  } finally {
    archive.dispose();
  }
}

function appendCwSphere(posList, velList, countList, idxList, center, radius, velocity, rings, segs) {
  const baseVert = posList.length / 3;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    for (let s = 0; s <= segs; s++) {
      const theta = (s / segs) * Math.PI * 2;
      const nx = sinP * Math.cos(theta);
      const ny = cosP;
      const nz = sinP * Math.sin(theta);
      posList.push(center[0] + nx * radius, center[1] + ny * radius, center[2] + nz * radius);
      velList.push(velocity[0], velocity[1], velocity[2]);
    }
  }
  const row = segs + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const p00 = baseVert + r * row + s;
      const p10 = p00 + row;
      const p11 = p10 + 1;
      const p01 = p00 + 1;
      countList.push(4);
      idxList.push(p00, p10, p11, p01);
    }
  }
}

async function buildFluidSplashArchive() {
  const fps = 24;
  const frames = 60;
  const archive = await createArchive({
    appName: "alembic-wasm Fluid Sim Generator",
    userDescription: "Heterogeneous PolyMesh with per-frame varying topology and .velocities",
    dccFps: fps,
  });

  try {
    const tsIdx = archive.addUniformTimeSampling(fps, { isFps: true, startTime: 0 });
    const top = archive.top;

    const mats = top.addChild("materials");
    const liquidMat = mats.addMaterial("liquidCobalt");
    writeUsdPreviewMaterial(liquidMat, {
      diffuse: [0.16, 0.62, 0.95],
      roughness: 0.14,
      metallic: 0.05,
    });
    liquidMat.dispose();
    mats.dispose();

    const fluidXform = top.addXform("fluidSolver", { timeSamplingIndex: 0 });
    fluidXform.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const fluidObj = fluidXform.object;

    const poly = fluidObj.addPolyMesh("splashMeshShape", { timeSamplingIndex: tsIdx });
    const polyObj = poly.object;
    polyObj.assignMaterial("/materials/liquidCobalt");

    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const posList = [];
      const velList = [];
      const countList = [];
      const idxList = [];

      // Pool surface with varying grid resolution per frame to guarantee heterogeneous topology!
      const gridN = 16 + (f % 5) * 2;
      const poolSize = 4.6;
      const baseV = 0;
      for (let iz = 0; iz <= gridN; iz++) {
        const z = (iz / gridN - 0.5) * poolSize;
        for (let ix = 0; ix <= gridN; ix++) {
          const x = (ix / gridN - 0.5) * poolSize;
          const r = Math.hypot(x, z);
          const ripple = Math.cos(r * 4.2 - t * 7.5) * 0.22 * Math.exp(-r * 0.45);
          const rippleVel = Math.sin(r * 4.2 - t * 7.5) * 0.22 * 7.5 * Math.exp(-r * 0.45);
          posList.push(x, ripple - 0.35, z);
          velList.push(0, rippleVel, 0);
        }
      }
      for (let iz = 0; iz < gridN; iz++) {
        for (let ix = 0; ix < gridN; ix++) {
          const v00 = baseV + iz * (gridN + 1) + ix;
          const v10 = v00 + 1;
          const v11 = v00 + (gridN + 1) + 1;
          const v01 = v00 + (gridN + 1);
          countList.push(4);
          idxList.push(v00, v10, v11, v01);
        }
      }

      // Dynamic spawned / despawned liquid droplets (varying count per frame!)
      const totalDrops = 14;
      for (let d = 0; d < totalDrops; d++) {
        const cycle = (t * 0.85 + d / totalDrops) % 1.0;
        if (cycle > 0.82) continue; // Droplet re-merged with pool!
        const u = cycle / 0.82;
        const angle = d * 2.39996 + t * 0.6;
        const radialSpeed = 0.65 + (d % 4) * 0.28;
        const px = Math.cos(angle) * radialSpeed * u * 1.7;
        const pz = Math.sin(angle) * radialSpeed * u * 1.7;
        const v0y = 3.8 + (d % 3) * 0.55;
        const g = 9.2;
        const py = -0.3 + v0y * u - 0.5 * g * u * u;
        const vx = Math.cos(angle) * radialSpeed * 1.7 * (0.85 / 0.82);
        const vz = Math.sin(angle) * radialSpeed * 1.7 * (0.85 / 0.82);
        const vy = (v0y - g * u) * (0.85 / 0.82);
        const rad = 0.14 + (1 - u) * 0.12;
        appendCwSphere(posList, velList, countList, idxList, [px, py, pz], rad, [vx, vy, vz], 6, 10);
      }

      poly.setSample({
        positions: new Float32Array(posList),
        velocities: new Float32Array(velList),
        faceCounts: new Int32Array(countList),
        faceIndices: new Int32Array(idxList),
      });
    }

    polyObj.dispose();
    poly.dispose();
    fluidObj.dispose();
    fluidXform.dispose();

    return {
      fileName: "procedural_fluid_splash.abc",
      bytes: archive.finalize(),
    };
  } finally {
    archive.dispose();
  }
}

async function buildCurvesAndParticlesArchive() {
  const fps = 24;
  const frames = 60;
  const archive = await createArchive({
    appName: "alembic-wasm Groom & FX Generator",
    userDescription: "SubD Catmull-Clark Emitter + Cubic B-Spline Curves + RGB Particle Fountain",
    dccFps: fps,
  });

  try {
    const tsIdx = archive.addUniformTimeSampling(fps, { isFps: true, startTime: 0 });
    const top = archive.top;

    const mats = top.addChild("materials");
    const coreMat = mats.addMaterial("copperCore");
    writeUsdPreviewMaterial(coreMat, {
      diffuse: [0.85, 0.48, 0.28],
      roughness: 0.3,
      metallic: 0.72,
    });
    coreMat.dispose();
    mats.dispose();

    // 1. SubD Catmull-Clark subdivided core with top crease
    const coreXform = top.addXform("emitterCore", { timeSamplingIndex: 0 });
    coreXform.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.55, 0, 1]);
    const coreObj = coreXform.object;
    const subd = coreObj.addSubD("subdCoreShape", { timeSamplingIndex: 0 });
    const subdObj = subd.object;
    subdObj.assignMaterial("/materials/copperCore");

    const s = 0.55;
    // Cube control cage (CW faces)
    const cubePos = new Float32Array([
      -s, -s, -s,  s, -s, -s,  s,  s, -s, -s,  s, -s,
      -s, -s,  s,  s, -s,  s,  s,  s,  s, -s,  s,  s,
    ]);
    const cubeCounts = new Int32Array([4, 4, 4, 4, 4, 4]);
    const cubeIndices = new Int32Array([
      0, 1, 2, 3, // -Z
      5, 4, 7, 6, // +Z
      4, 0, 3, 7, // -X
      1, 5, 6, 2, // +X
      3, 2, 6, 7, // +Y
      4, 5, 1, 0, // -Y
    ]);
    subd.setSample({
      positions: cubePos,
      faceCounts: cubeCounts,
      faceIndices: cubeIndices,
      subdivisionScheme: "catmull-clark",
      creaseIndices: new Int32Array([3, 2, 2, 6, 6, 7, 7, 3]),
      creaseLengths: new Int32Array([2, 2, 2, 2]),
      creaseSharpnesses: new Float32Array([3.0, 3.0, 3.0, 3.0]),
    });
    subdObj.dispose();
    subd.dispose();
    coreObj.dispose();
    coreXform.dispose();

    // 2. Animated Cubic B-Spline Strands
    const groomXform = top.addXform("splineGroom", { timeSamplingIndex: 0 });
    groomXform.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const groomObj = groomXform.object;
    const curves = groomObj.addCurves("windStrandsShape", { timeSamplingIndex: tsIdx });

    const numStrands = 40;
    const cvsPerStrand = 7;
    const curvesNumVertices = new Int32Array(numStrands).fill(cvsPerStrand);
    const curvePos = new Float32Array(numStrands * cvsPerStrand * 3);
    const curveWidths = new Float32Array(numStrands * cvsPerStrand);

    for (let c = 0; c < numStrands; c++) {
      for (let k = 0; k < cvsPerStrand; k++) {
        curveWidths[c * cvsPerStrand + k] = 0.03 * (1 - k / cvsPerStrand) + 0.004;
      }
    }

    for (let f = 0; f < frames; f++) {
      const phase = (f / frames) * Math.PI * 2;
      for (let c = 0; c < numStrands; c++) {
        const baseAngle = (c / numStrands) * Math.PI * 2;
        const ringR = 0.65 + (c % 3) * 0.22;
        const rootX = Math.cos(baseAngle) * ringR;
        const rootZ = Math.sin(baseAngle) * ringR;
        for (let k = 0; k < cvsPerStrand; k++) {
          const h = k / (cvsPerStrand - 1);
          const swayX = Math.sin(phase + c * 0.35 + h * 2.2) * h * h * 0.65;
          const swayZ = Math.cos(phase * 2 + c * 0.25 + h * 1.8) * h * h * 0.35;
          const flare = 1 + h * 0.85;
          const idx = (c * cvsPerStrand + k) * 3;
          curvePos[idx] = rootX * flare + swayX;
          curvePos[idx + 1] = 0.2 + h * 2.4;
          curvePos[idx + 2] = rootZ * flare + swayZ;
        }
      }
      curves.setSample({
        positions: curvePos,
        curvesNumVertices: f === 0 ? curvesNumVertices : undefined,
        type: CurveType.Cubic,
        wrap: CurvePeriodicity.NonPeriodic,
        basis: BasisType.BSpline,
        widths: f === 0 ? curveWidths : undefined,
        widthScope: GeometryScope.Vertex,
      });
    }
    curves.dispose();
    groomObj.dispose();
    groomXform.dispose();

    // 3. Helical RGB Particle Fountain (IPoints)
    const ptsXform = top.addXform("particleVortex", { timeSamplingIndex: 0 });
    ptsXform.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const ptsObj = ptsXform.object;
    const points = ptsObj.addPoints("vortexPointsShape", { timeSamplingIndex: tsIdx });

    const numParticles = 640;
    const ids = new BigUint64Array(numParticles);
    const ptColors = new Float32Array(numParticles * 3);
    const ptWidths = new Float32Array(numParticles);
    const tmpCol = new THREE.Color();

    for (let i = 0; i < numParticles; i++) {
      ids[i] = BigInt(1000 + i);
      tmpCol.setHSL((i / numParticles) % 1, 0.82, 0.62);
      ptColors[i * 3] = tmpCol.r;
      ptColors[i * 3 + 1] = tmpCol.g;
      ptColors[i * 3 + 2] = tmpCol.b;
      ptWidths[i] = 0.055;
    }

    const ptArb = points.getArbGeomParams();
    const ptCd = ptArb.createGeomParam("Cd", {
      pod: PlainOldDataType.Float32,
      extent: 3,
      scope: GeometryScope.Vertex,
      interpretation: "rgb",
    });
    ptCd.setSample(ptColors);
    ptCd.dispose();
    ptArb.dispose();

    const ptPos = new Float32Array(numParticles * 3);
    const ptVel = new Float32Array(numParticles * 3);

    for (let f = 0; f < frames; f++) {
      const tNorm = f / frames;
      for (let i = 0; i < numParticles; i++) {
        const life = (tNorm + i / numParticles) % 1.0;
        const theta = life * Math.PI * 6 + (i % 5) * ((Math.PI * 2) / 5);
        const radius = 0.9 + life * 1.9;
        ptPos[i * 3] = Math.cos(theta) * radius;
        ptPos[i * 3 + 1] = life * 3.2;
        ptPos[i * 3 + 2] = Math.sin(theta) * radius;

        ptVel[i * 3] = -Math.sin(theta) * radius * 2.5;
        ptVel[i * 3 + 1] = 1.2;
        ptVel[i * 3 + 2] = Math.cos(theta) * radius * 2.5;
      }
      points.setSample({
        positions: ptPos,
        ids,
        velocities: ptVel,
        widths: f === 0 ? ptWidths : undefined,
        widthScope: GeometryScope.Vertex,
      });
    }

    points.dispose();
    ptsObj.dispose();
    ptsXform.dispose();

    return {
      fileName: "procedural_curves_particles_subd.abc",
      bytes: archive.finalize(),
    };
  } finally {
    archive.dispose();
  }
}

function buildBoxSample(hx, hy, hz) {
  const positions = new Float32Array([
    -hx, -hy, -hz,  hx, -hy, -hz,  hx,  hy, -hz, -hx,  hy, -hz,
    -hx, -hy,  hz,  hx, -hy,  hz,  hx,  hy,  hz, -hx,  hy,  hz,
  ]);
  const faceCounts = new Int32Array([4, 4, 4, 4, 4, 4]);
  const faceIndices = new Int32Array([
    0, 1, 2, 3,
    5, 4, 7, 6,
    4, 0, 3, 7,
    1, 5, 6, 2,
    3, 2, 6, 7,
    4, 5, 1, 0,
  ]);
  return { positions, faceCounts, faceIndices };
}

async function buildRoboticInstancesArchive() {
  const fps = 24;
  const frames = 72;
  const archive = await createArchive({
    appName: "alembic-wasm Robotics & CAD Generator",
    userDescription: "Articulated XformOp Hierarchy + Rational NuPatch Canopy + 12 Object Instances",
    dccFps: fps,
  });

  try {
    const tsIdx = archive.addUniformTimeSampling(fps, { isFps: true, startTime: 0 });
    const top = archive.top;

    const mats = top.addChild("materials");
    const steelMat = mats.addMaterial("brushedSteel");
    writeUsdPreviewMaterial(steelMat, {
      diffuse: [0.68, 0.73, 0.78],
      roughness: 0.28,
      metallic: 0.8,
    });
    steelMat.dispose();

    const accentMat = mats.addMaterial("amberAccent");
    writeUsdPreviewMaterial(accentMat, {
      diffuse: [0.94, 0.56, 0.16],
      emissive: [0.15, 0.06, 0.0],
      roughness: 0.32,
      metallic: 0.4,
    });
    accentMat.dispose();

    const glassMat = mats.addMaterial("canopyCyan");
    writeUsdPreviewMaterial(glassMat, {
      diffuse: [0.22, 0.75, 0.85],
      roughness: 0.18,
      metallic: 0.1,
    });
    glassMat.dispose();
    mats.dispose();

    // 1. Prototype Pillar + 12 Radial Instances
    const ringGroup = top.addChild("instanceRing");
    const protoHolder = ringGroup.addChild("__pillarProto");
    protoHolder.setVisibility(ObjectVisibility.Hidden, 0);
    const protoMesh = protoHolder.addPolyMesh("pillarShape", { timeSamplingIndex: 0 });
    const protoMeshObj = protoMesh.object;
    protoMeshObj.assignMaterial("/materials/brushedSteel");
    protoMesh.setSample(buildBoxSample(0.14, 0.55, 0.14));

    const numInst = 12;
    for (let i = 0; i < numInst; i++) {
      const angle = (i / numInst) * Math.PI * 2;
      const instXform = ringGroup.addXform(`pillarInst_${i}`, { timeSamplingIndex: tsIdx });
      const instObj = instXform.object;
      instObj.addChildInstance(protoMeshObj, "shape");
      for (let f = 0; f < frames; f++) {
        const wave = Math.sin((f / frames) * Math.PI * 2 + i * 0.52) * 0.18;
        instXform.setOpsSample([
          {
            type: XformOperationType.Translate,
            channels: [Math.cos(angle) * 2.6, 0.55 + wave, Math.sin(angle) * 2.6],
          },
          {
            type: XformOperationType.RotateY,
            channels: [(-angle * 180) / Math.PI],
          },
        ]);
      }
      instObj.dispose();
      instXform.dispose();
    }
    protoMeshObj.dispose();
    protoMesh.dispose();
    protoHolder.dispose();
    ringGroup.dispose();

    // 2. Articulated 3-Link Robotic Arm using XformOp stacks
    const baseTurret = top.addXform("turretBase", { timeSamplingIndex: tsIdx });
    const baseObj = baseTurret.object;
    const baseGeo = baseObj.addPolyMesh("turretShape");
    const baseGeoObj = baseGeo.object;
    baseGeoObj.assignMaterial("/materials/brushedSteel");
    baseGeo.setSample(buildBoxSample(0.55, 0.2, 0.55));
    baseGeoObj.dispose();
    baseGeo.dispose();

    const lowerArm = baseObj.addXform("lowerArm", { timeSamplingIndex: tsIdx });
    const lowerObj = lowerArm.object;
    const lowerGeo = lowerObj.addPolyMesh("lowerArmShape");
    const lowerGeoObj = lowerGeo.object;
    lowerGeoObj.assignMaterial("/materials/amberAccent");
    const lowerBox = buildBoxSample(0.16, 0.65, 0.16);
    for (let i = 1; i < lowerBox.positions.length; i += 3) lowerBox.positions[i] += 0.65;
    lowerGeo.setSample(lowerBox);
    lowerGeoObj.dispose();
    lowerGeo.dispose();

    const upperArm = lowerObj.addXform("upperArm", { timeSamplingIndex: tsIdx });
    const upperObj = upperArm.object;
    const upperGeo = upperObj.addPolyMesh("upperArmShape");
    const upperGeoObj = upperGeo.object;
    upperGeoObj.assignMaterial("/materials/brushedSteel");
    const upperBox = buildBoxSample(0.12, 0.55, 0.12);
    for (let i = 1; i < upperBox.positions.length; i += 3) upperBox.positions[i] += 0.55;
    upperGeo.setSample(upperBox);
    upperGeoObj.dispose();
    upperGeo.dispose();

    // Animated visibility beacon at arm tip
    const beacon = upperObj.addXform("tipBeacon", { timeSamplingIndex: 0 });
    beacon.setOpsSample([{ type: XformOperationType.Translate, channels: [0, 1.18, 0] }]);
    const beaconObj = beacon.object;
    const beaconGeo = beaconObj.addPolyMesh("beaconShape");
    const beaconGeoObj = beaconGeo.object;
    beaconGeoObj.assignMaterial("/materials/amberAccent");
    beaconGeo.setSample(buildBoxSample(0.15, 0.15, 0.15));
    beaconGeoObj.dispose();
    beaconGeo.dispose();

    for (let f = 0; f < frames; f++) {
      const p = (f / frames) * Math.PI * 2;
      baseTurret.setOpsSample([
        { type: XformOperationType.Translate, channels: [0, 0.2, 0] },
        { type: XformOperationType.RotateY, channels: [(p * 180) / Math.PI] },
      ]);
      lowerArm.setOpsSample([
        { type: XformOperationType.Translate, channels: [0, 0.2, 0] },
        { type: XformOperationType.RotateZ, channels: [Math.sin(p) * 32] },
      ]);
      upperArm.setOpsSample([
        { type: XformOperationType.Translate, channels: [0, 1.3, 0] },
        { type: XformOperationType.RotateZ, channels: [Math.cos(p) * 42 - 20] },
      ]);
      beaconObj.setVisibility(
        Math.floor(f / 6) % 2 === 0 ? ObjectVisibility.Visible : ObjectVisibility.Hidden,
        tsIdx
      );
    }

    beaconObj.dispose();
    beacon.dispose();
    upperObj.dispose();
    upperArm.dispose();
    lowerObj.dispose();
    lowerArm.dispose();
    baseObj.dispose();
    baseTurret.dispose();

    // 3. Rational Bicubic NURBS Canopy (INuPatch)
    const canopyXform = top.addXform("nurbsCanopy", { timeSamplingIndex: 0 });
    canopyXform.setOpsSample([{ type: XformOperationType.Translate, channels: [0, 2.85, 0] }]);
    const canopyObj = canopyXform.object;
    const patch = canopyObj.addNuPatch("canopyPatchShape", { timeSamplingIndex: 0 });
    const patchObj = patch.object;
    patchObj.assignMaterial("/materials/canopyCyan");

    const numU = 4;
    const numV = 4;
    // Open uniform cubic knots: num + order = 4 + 4 = 8 knots (or Alembic convention num + order = 8)
    const knots = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]);
    const patchPos = new Float32Array(numU * numV * 3);
    const patchWeights = new Float32Array(numU * numV).fill(1.0);
    for (let iv = 0; iv < numV; iv++) {
      const z = (iv / (numV - 1) - 0.5) * 3.4;
      for (let iu = 0; iu < numU; iu++) {
        const x = (iu / (numU - 1) - 0.5) * 3.4;
        const interior = iu > 0 && iu < numU - 1 && iv > 0 && iv < numV - 1;
        const idx = (iv * numU + iu) * 3;
        patchPos[idx] = x;
        patchPos[idx + 1] = interior ? 0.75 : -0.15;
        patchPos[idx + 2] = z;
        if (interior) patchWeights[iv * numU + iu] = 1.6;
      }
    }
    patch.setSample({
      positions: patchPos,
      numU,
      numV,
      uOrder: 4,
      vOrder: 4,
      uKnot: knots,
      vKnot: knots,
      positionWeights: patchWeights,
    });
    patchObj.dispose();
    patch.dispose();
    canopyObj.dispose();
    canopyXform.dispose();

    return {
      fileName: "procedural_robotic_instances_nupatch.abc",
      bytes: archive.finalize(),
    };
  } finally {
    archive.dispose();
  }
}
