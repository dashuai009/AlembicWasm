# alembic-wasm

Comprehensive WebAssembly (`WASM`) bindings and strongly-typed TypeScript SDK for **Alembic (`.abc` Ogawa 1.8.x)** reading, writing, and multi-archive layering across Browser, Web Worker, and Node.js — plus an optional **Three.js** plugin (`alembic-wasm/three`).

**Live Demo:** https://dashuai009.github.io/AlembicWasm/

---

## Features

- **Full Ogawa Read & Write (`IArchive` / `OArchive`)**: Zero-double-copy in-memory reader and seekable dynamic memory writer producing standard `.abc` files compatible with Houdini, Maya, Blender, Unreal Engine, and Cinema 4D.
- **Archive Layering (`AbcCoreLayer`)**: Merge multiple `.abc` buffers in memory (`openLayeredArchive`) with `withLayerPrune` / `withLayerReplace` overrides.
- **Complete Schema Coverage**:
  - `AbcGeom`: `Xform` (matrix & full `XformOp` stack), `PolyMesh`, `SubD` (Catmull-Clark subdivision, creases, corners, holes), `FaceSet`, `Camera` (aperture, focal length, film back ops), `Curves` (Linear, Bezier, B-Spline, Catmull-Rom, rational NURBS), `Points` (64-bit IDs, velocities, widths), `NuPatch` (rational NURBS surface tessellation), `Light`, `ObjectVisibility`.
  - `AbcMaterial`: `IMaterial` / `OMaterial`, shader networks, `MaterialFlatten`, object & `FaceSet` material assignments (`UsdPreviewSurface` PBR ready).
  - `AbcCollection`: `ICollections` / `OCollections`.
- **Generic Properties & `GeomParam`s**: Read and write `Compound`, `Scalar`, and `Array` properties across all **14 POD types** (`boolean`, `int8..uint64`, `float16` auto-converted, `float32`, `float64`, `string`, `wstring`), arbitrary `extent` (`V2f`, `V3f`, `C4f`, `M44d`, …), and indexed/non-indexed `IGeomParam` / `OGeomParam` across all 5 `GeometryScope`s.
- **Three.js Subpath Plugin (`alembic-wasm/three`)**:
  - `ABCLoader` (`THREE.Loader<THREE.Group>`): C++ corner welding, CW→CCW winding conversion, FaceSet multi-materials, instancing, accurate vertical aperture camera FOV.
  - `AlembicSceneController`: Streaming arbitrary-time playback supporting constant, homogeneous sub-frame C++ interpolated meshes, and **heterogeneous fluid/remeshed topologies** with velocity advection — plus `.toAnimationClip()` for `THREE.AnimationMixer`.
  - `ABCExporter`: Export static or animated `THREE.Object3D` scenes (meshes, morph/skinned deformations, `InstancedMesh`, cameras, points, curves, PBR materials) to `.abc` `Uint8Array`.

---

## Installation

```bash
npm install alembic-wasm
```

To use the Three.js integration (`alembic-wasm/three`), install `three` as a peer dependency:

```bash
npm install three
```

---

## Quick Start — Core SDK (`alembic-wasm`)

### Reading an `.abc` Archive

```ts
import { openArchive, SampleSelector } from "alembic-wasm";

const archive = await openArchive("/assets/animation.abc"); // URL, File/Blob, ArrayBuffer, Uint8Array, or Node path
console.log(archive.info);
console.log(archive.echo());

archive.top.traverse((obj) => {
  const schema = obj.asSchema();
  if (!schema) return;

  if (schema.kind === "PolyMesh") {
    const mesh = schema.buildRenderMesh(SampleSelector.floor(0.5));
    console.log(obj.fullName, mesh.vertexCount, mesh.indexCount);
  }
  schema.dispose();
});

archive.close();
```

### Authoring an `.abc` Archive in Memory

```ts
import { createArchive, GeometryScope } from "alembic-wasm";

const archive = await createArchive({
  appName: "my-web-dcc",
  dccFps: 24,
});

const ts = archive.addUniformTimeSampling(24, { isFps: true, startTime: 0 });
const xform = archive.top.addXform("heroRig", { timeSamplingIndex: ts });
const xformObj = xform.object;
const poly = xformObj.addPolyMesh("quadShape", { timeSamplingIndex: 0 });

xform.setMatrixSample([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1]);
poly.setSample({
  positions: new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
  faceCounts: new Int32Array([4]),
  faceIndices: new Int32Array([0, 1, 2, 3]), // CW front-facing
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  uvScope: GeometryScope.Vertex,
});

poly.dispose();
xformObj.dispose();
xform.dispose();

const abcBytes: Uint8Array = archive.finalize();
```

---

## Quick Start — Three.js Plugin (`alembic-wasm/three`)

```ts
import * as THREE from "three";
import { ABCLoader, ABCExporter } from "alembic-wasm/three";

const loader = new ABCLoader();
const controller = await loader.loadWithControllerAsync("/assets/simulation.abc");
scene.add(controller.root);

// Option A: Stream arbitrary-time samples (supports both fixed & fluid/changing topology!)
function renderLoop(dt: number) {
  controller.update(dt);
  renderer.render(scene, camera);
}

// Option B: Convert to standard THREE.AnimationClip for AnimationMixer
const clip = controller.toAnimationClip();

// Export any Three.js Object3D hierarchy back to Ogawa .abc bytes
const exporter = new ABCExporter();
const exportedBytes = await exporter.parseAsync(scene, { fps: 24 });
```

---

## Development & Building from Source

### Directory Layout

```text
alembic-wasm/
├── xmake.lua              # C++17 / Emscripten WebAssembly build configuration
├── package.json           # Publishable npm package ("alembic-wasm" + "alembic-wasm/three")
├── tsconfig.json          # TypeScript compiler configuration (pure tsc -> dist/)
├── src/
│   ├── cpp/               # C++17 Embind headers (include/abc_wasm/) & binding units (bind_*.cpp)
│   ├── wasm/              # Cross-platform WASM loader, scratch arena & generated wasm/js
│   ├── core/              # Framework-agnostic TypeScript Core SDK ("alembic-wasm")
│   ├── three/             # Optional Three.js plugin ("alembic-wasm/three")
│   └── index.ts
├── tests/                 # End-to-end Vitest suites against real WASM
└── example/               # Standalone HTML + CSS + Vanilla JS 3D studio example
```

### 1. Build C++ WebAssembly Module (`src/cpp/`)

Requires [xmake](https://xmake.io) and [Emscripten (`emcc`)](https://emscripten.org):

```bash
npm run build:wasm
```

Compiled artifacts are automatically copied to `src/wasm/generated/alembic_wasm.{js,wasm}`.

### 2. Build NPM Package (`dist/`) & Run Tests

```bash
npm install
npm test
npm run build:ts
```

### 3. Run Standalone HTML + Vanilla JS Studio Example (`example/`)

```bash
cd example
npm install
npm run dev
```
