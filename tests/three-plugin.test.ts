import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createArchive } from "../src/index.js";
import { ABCExporter, ABCLoader } from "../src/three/index.js";

describe("Three.js Plugin (ABCLoader, AlembicSceneController, AnimationClipBuilder, ABCExporter)", () => {
  it("converts CW quads to CCW triangles with +Y upward normals and preserves sheared Xforms", async () => {
    const writer = await createArchive({ appName: "winding-shear-test" });
    const sheared = writer.top.addXform("shearedGroup");
    // 4x4 matrix with X-Y shear: x' = x + 0.5 * y
    sheared.setMatrixSample([
      1, 0, 0, 0,
      0.5, 1, 0, 0,
      0, 0, 1, 0,
      2, 3, 4, 1,
    ]);
    const shObj = sheared.object;

    const poly = shObj.addPolyMesh("floorQuad");
    // CW quad in XZ plane when viewed from +Y: (-1,0,-1) -> (1,0,-1) -> (1,0,1) -> (-1,0,1)
    poly.setSample({
      positions: new Float32Array([
        -1, 0, -1,
         1, 0, -1,
         1, 0,  1,
        -1, 0,  1,
      ]),
      faceCounts: new Int32Array([4]),
      faceIndices: new Int32Array([0, 1, 2, 3]),
    });
    poly.dispose();
    shObj.dispose();
    sheared.dispose();

    const bytes = writer.finalize();
    const loader = new ABCLoader();
    const controller = await loader.loadWithControllerAsync(bytes);
    try {
      const shNode = controller.root.getObjectByName("shearedGroup")!;
      expect(shNode.matrixAutoUpdate).toBe(false);
      expect(shNode.matrix.elements[4]).toBeCloseTo(0.5, 5);
      expect(shNode.matrix.elements[12]).toBeCloseTo(2.0, 5);

      const mesh = controller.root.getObjectByName("floorQuad") as THREE.Mesh;
      expect(mesh.isMesh).toBe(true);
      const norm = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
      expect(norm.getY(0)).toBeCloseTo(1.0, 5);

      // Verify CCW triangle cross product points +Y
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const idx = mesh.geometry.getIndex()!;
      const pA = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
      const pB = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
      const pC = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
      const cross = new THREE.Vector3().subVectors(pB, pA).cross(new THREE.Vector3().subVectors(pC, pA));
      expect(cross.y).toBeGreaterThan(0);
    } finally {
      controller.dispose();
    }
  });

  it("streams heterogeneous fluid topology with velocity advection and exports AnimationClip", async () => {
    const writer = await createArchive({ appName: "hetero-and-clip", dccFps: 10 });
    const ts = writer.addUniformTimeSampling(10, { isFps: true, startTime: 0 }); // dt = 0.1s

    // Animated Xform
    const mover = writer.top.addXform("mover", { timeSamplingIndex: ts });
    mover.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    mover.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);
    mover.dispose();

    // Heterogeneous PolyMesh: 1 triangle at frame 0 (with +Y velocity 20 u/s), 2 triangles at frame 1!
    const fluid = writer.top.addPolyMesh("fluidSurface", { timeSamplingIndex: ts });
    fluid.setSample({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      velocities: new Float32Array([0, 20, 0, 0, 20, 0, 0, 20, 0]),
      faceCounts: new Int32Array([3]),
      faceIndices: new Int32Array([0, 1, 2]),
    });
    fluid.setSample({
      positions: new Float32Array([0, 2, 0, 1, 2, 0, 0, 2, 1, 1, 2, 1]),
      velocities: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      faceCounts: new Int32Array([3, 3]),
      faceIndices: new Int32Array([0, 1, 2, 1, 3, 2]),
    });
    fluid.dispose();

    const bytes = writer.finalize();
    const loader = new ABCLoader();
    const ctrl = await loader.loadWithControllerAsync(bytes);
    try {
      expect(ctrl.heterogeneousMeshBindings.length).toBe(1);
      const fluidMesh = ctrl.root.getObjectByName("fluidSurface") as THREE.Mesh;
      expect(fluidMesh.geometry.getIndex()!.count).toBe(3);

      // Sub-frame t=0.05s: still sample 0 topology (3 indices), advected +Y by 20 * 0.05 = +1.0!
      ctrl.setTime(0.05);
      const posMid = fluidMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      expect(posMid.getY(0)).toBeCloseTo(1.0, 4);

      // Frame 1 at t=0.1s: topology switches cleanly to 2 triangles (6 indices)!
      ctrl.setTime(0.1);
      expect(fluidMesh.geometry.getIndex()!.count).toBe(6);

      // AnimationClip conversion for Xform via THREE.AnimationMixer
      const clip = ctrl.toAnimationClip();
      expect(clip.tracks.length).toBeGreaterThanOrEqual(3);
      const moverNode = ctrl.root.getObjectByName("mover")!;
      const mixer = new THREE.AnimationMixer(ctrl.root);
      mixer.clipAction(clip).play();
      mixer.setTime(0.05);
      expect(moverNode.position.x).toBeCloseTo(5.0, 4);
    } finally {
      ctrl.dispose();
    }
  });

  it("round-trips a full Three.js scene (Multi-Material Mesh, InstancedMesh, Camera, Points, Line) via ABCExporter -> ABCLoader", async () => {
    const scene = new THREE.Scene();

    // 1. Multi-material BoxGeometry Mesh (6 material groups!)
    const boxGeom = new THREE.BoxGeometry(2, 2, 2);
    const matRed = new THREE.MeshStandardMaterial({
      name: "redMat",
      color: new THREE.Color(0.9, 0.1, 0.1),
      roughness: 0.25,
      metalness: 0.5,
    });
    const matBlue = new THREE.MeshStandardMaterial({
      name: "blueMat",
      color: new THREE.Color(0.1, 0.3, 0.9),
      roughness: 0.65,
      metalness: 0.1,
    });
    const materials = [matRed, matRed, matRed, matBlue, matBlue, matBlue];
    const heroBox = new THREE.Mesh(boxGeom, materials);
    heroBox.name = "heroBox";
    heroBox.position.set(1, 2, 3);
    scene.add(heroBox);

    // 2. InstancedMesh with 3 instances
    const instGeom = new THREE.TetrahedronGeometry(0.5);
    const instMat = new THREE.MeshStandardMaterial({ name: "goldInst", color: 0xffaa00 });
    const instMesh = new THREE.InstancedMesh(instGeom, instMat, 3);
    instMesh.name = "scatter";
    const m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) {
      m.makeTranslation(i * 2, 0.5, -1);
      instMesh.setMatrixAt(i, m);
    }
    scene.add(instMesh);

    // 3. PerspectiveCamera with exact FOV & aspect
    const cam = new THREE.PerspectiveCamera(37.5, 16 / 9, 0.25, 450);
    cam.name = "renderCam";
    cam.position.set(0, 4, 10);
    scene.add(cam);

    // 4. Points & Line
    const ptsGeom = new THREE.BufferGeometry();
    ptsGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 1, 2, 3]), 3));
    const pts = new THREE.Points(ptsGeom, new THREE.PointsMaterial({ size: 0.12 }));
    pts.name = "cloud";
    scene.add(pts);

    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 2, 0, 0]), 3)
    );
    const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial());
    line.name = "guideCurve";
    scene.add(line);

    // Animated export via AnimationClip on heroBox
    const animClip = new THREE.AnimationClip("moveBox", 0.5, [
      new THREE.VectorKeyframeTrack(
        `${heroBox.uuid}.position`,
        [0, 0.5],
        [1, 2, 3, 5, 2, 3]
      ),
    ]);

    const exporter = new ABCExporter();
    const abcBytes = await exporter.parseAsync(scene, {
      fps: 10,
      clips: [animClip],
    });
    expect(abcBytes.byteLength).toBeGreaterThan(256);

    const loader = new ABCLoader();
    const loadedCtrl = await loader.loadWithControllerAsync(abcBytes);
    try {
      expect(loadedCtrl.cameras.length).toBe(1);
      const loadedCam = loadedCtrl.cameras[0]!;
      expect(loadedCam.fov).toBeCloseTo(37.5, 3);
      expect(loadedCam.aspect).toBeCloseTo(16 / 9, 3);
      expect(loadedCam.near).toBeCloseTo(0.25, 3);
      expect(loadedCam.far).toBeCloseTo(450, 2);

      // Verify animated heroBox at t=0.25s -> x=3.0!
      loadedCtrl.setTime(0.25);
      const loadedBoxGrp = loadedCtrl.root.getObjectByName("heroBox")!;
      expect(loadedBoxGrp.position.x).toBeCloseTo(3.0, 3);

      // Verify multi-material FaceSet groups restored on heroBoxShape
      const loadedBoxMesh = loadedCtrl.root.getObjectByName("heroBoxShape") as THREE.Mesh;
      expect(Array.isArray(loadedBoxMesh.material)).toBe(true);
      const loadedMats = loadedBoxMesh.material as THREE.MeshStandardMaterial[];
      expect(loadedMats.length).toBeGreaterThanOrEqual(2);

      // Verify 3 instances share a single BufferGeometry instance!
      const scatterGrp = loadedCtrl.root.getObjectByName("scatter")!;
      const instanceMeshes: THREE.Mesh[] = [];
      scatterGrp.traverse((n) => {
        if ((n as THREE.Mesh).isMesh && n.visible && n.parent?.visible !== false) {
          instanceMeshes.push(n as THREE.Mesh);
        }
      });
      expect(instanceMeshes.length).toBe(3);
      expect(instanceMeshes[0]!.geometry).toBe(instanceMeshes[1]!.geometry);
      expect(instanceMeshes[1]!.geometry).toBe(instanceMeshes[2]!.geometry);
    } finally {
      loadedCtrl.dispose();
    }
  });
});
