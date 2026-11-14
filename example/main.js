import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  getLibraryVersionShort,
  initAlembic,
  podName,
  TopologyVariance,
} from "alembic-wasm";
import { ABCLoader, ABCExporter } from "alembic-wasm/three";
import { DEMO_PRESETS, generateProceduralAbc } from "./procedural-demos.js";

// --- DOM Elements ---
const canvas = document.getElementById("viewport-canvas");
const viewportPane = document.getElementById("viewport-pane");
const dropOverlay = document.getElementById("drop-overlay");
const statusToast = document.getElementById("status-toast");
const wasmVersionBadge = document.getElementById("wasm-version-badge");

const presetSelect = document.getElementById("preset-select");
const fileInput = document.getElementById("file-input");
const btnExportAbc = document.getElementById("btn-export-abc");
const btnRoundtrip = document.getElementById("btn-roundtrip");
const cameraSelect = document.getElementById("camera-select");
const btnFitView = document.getElementById("btn-fit-view");
const btnWireframe = document.getElementById("btn-wireframe");
const btnBounds = document.getElementById("btn-bounds");
const btnGrid = document.getElementById("btn-grid");

const hudFilename = document.getElementById("hud-filename");
const hudDescription = document.getElementById("hud-description");
const hudObjects = document.getElementById("hud-objects");
const hudMeshes = document.getElementById("hud-meshes");
const hudTriangles = document.getElementById("hud-triangles");
const hudBytes = document.getElementById("hud-bytes");

const treeCountBadge = document.getElementById("tree-count-badge");
const hierarchyTreeEl = document.getElementById("hierarchy-tree");
const selectedNodeTitle = document.getElementById("selected-node-title");
const selectedNodeSchema = document.getElementById("selected-node-schema");
const nodeDetailsBody = document.getElementById("node-details-body");
const archiveMetaGrid = document.getElementById("archive-meta-grid");
const timeSamplingsList = document.getElementById("timesamplings-list");
const echoOutput = document.getElementById("echo-output");
const btnRefreshEcho = document.getElementById("btn-refresh-echo");

const btnStepPrev = document.getElementById("btn-step-prev");
const btnPlayToggle = document.getElementById("btn-play-toggle");
const btnStepNext = document.getElementById("btn-step-next");
const timelineSlider = document.getElementById("timeline-slider");
const readoutTime = document.getElementById("readout-time");
const readoutFrame = document.getElementById("readout-frame");
const readoutRange = document.getElementById("readout-range");
const readoutFps = document.getElementById("readout-fps");
const interpSelect = document.getElementById("interp-select");
const speedSelect = document.getElementById("speed-select");
const chkAdvect = document.getElementById("chk-advect");
const chkLoop = document.getElementById("chk-loop");

// --- Three.js Scene Setup ---
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11151d);

const orbitCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 2000);
orbitCamera.position.set(5.2, 3.6, 6.2);

const controls = new OrbitControls(orbitCamera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 0.7, 0);

// Studio 3-point lighting
const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
keyLight.position.set(7, 11, 8);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.0);
rimLight.position.set(-8, 5, -7);
scene.add(rimLight);

const gridHelper = new THREE.GridHelper(12, 24, 0x334155, 0x1e293b);
scene.add(gridHelper);

const loader = new ABCLoader();
const exporter = new ABCExporter();

// --- Application State ---
let activeController = null;
let activeCamera = orbitCamera;
let activeBoxHelper = null;
let currentFileName = "scene.abc";
let currentByteLength = 0;
let wireframeEnabled = false;
let boundsEnabled = false;
let isScrubbing = false;
let toastTimer = null;

function showToast(msg, durationMs = 2800) {
  statusToast.textContent = msg;
  statusToast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    statusToast.hidden = true;
  }, durationMs);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// --- Resize Handling ---
function handleResize() {
  const w = Math.max(1, viewportPane.clientWidth);
  const h = Math.max(1, viewportPane.clientHeight);
  renderer.setSize(w, h, false);
  orbitCamera.aspect = w / h;
  orbitCamera.updateProjectionMatrix();

  if (activeCamera !== orbitCamera && activeCamera.isPerspectiveCamera) {
    activeCamera.aspect = w / h;
    activeCamera.updateProjectionMatrix();
  }
}

const resizeObserver = new ResizeObserver(handleResize);
resizeObserver.observe(viewportPane);
handleResize();

// --- Fit Orbit Camera without touching Alembic cameras! ---
function fitOrbitCameraToRoot(rootObj) {
  const box = new THREE.Box3().setFromObject(rootObj);
  if (box.isEmpty()) {
    controls.target.set(0, 0.5, 0);
    orbitCamera.position.set(5, 3.5, 6);
    controls.update();
    return;
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);
  const fovRad = (orbitCamera.fov * Math.PI) / 180;
  const dist = (maxDim / (2 * Math.tan(fovRad / 2))) * 1.45;

  controls.target.copy(center);
  orbitCamera.position.set(
    center.x + dist * 0.72,
    center.y + dist * 0.52,
    center.z + dist * 0.78
  );
  orbitCamera.near = Math.max(0.01, dist / 200);
  orbitCamera.far = Math.max(500, dist * 25);
  orbitCamera.updateProjectionMatrix();
  controls.update();
}

function applyWireframeMode(rootObj, enabled) {
  rootObj.traverse((node) => {
    if (node.isMesh && node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if ("wireframe" in m) {
          m.wireframe = enabled;
        }
      }
    }
  });
}

function updateSceneMetrics() {
  if (!activeController) return;
  let objects = 0;
  let meshes = 0;
  let triangles = 0;

  activeController.root.traverse((obj) => {
    objects++;
    if (obj.isMesh && obj.geometry) {
      meshes++;
      const idx = obj.geometry.getIndex();
      const pos = obj.geometry.getAttribute("position");
      if (idx) {
        triangles += Math.floor(idx.count / 3);
      } else if (pos) {
        triangles += Math.floor(pos.count / 3);
      }
    }
  });

  hudObjects.textContent = String(objects);
  hudMeshes.textContent = String(meshes);
  hudTriangles.textContent = triangles.toLocaleString();
  hudBytes.textContent = formatBytes(currentByteLength);
}

// --- Dispose Previous Scene Cleanly ---
function unloadCurrentScene() {
  if (activeBoxHelper) {
    scene.remove(activeBoxHelper);
    activeBoxHelper.dispose();
    activeBoxHelper = null;
  }
  if (activeController) {
    scene.remove(activeController.root);
    activeController.root.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) m.dispose();
      }
    });
    activeController.dispose();
    activeController = null;
  }
  activeCamera = orbitCamera;
  controls.enabled = true;
}

// --- Load Archive from Bytes ---
async function loadAbcBuffer(bytes, fileName, subtitle = "") {
  unloadCurrentScene();

  currentFileName = fileName;
  currentByteLength = bytes.byteLength;

  const controller = await loader.loadWithControllerAsync(bytes);
  activeController = controller;
  controller.interpolation = interpSelect.value;
  controller.playbackRate = Number(speedSelect.value) || 1.0;
  controller.useVelocityAdvection = chkAdvect.checked;
  controller.loop = chkLoop.checked;
  controller.playing = controller.duration > 1e-6;

  scene.add(controller.root);
  applyWireframeMode(controller.root, wireframeEnabled);

  if (boundsEnabled) {
    activeBoxHelper = new THREE.BoxHelper(controller.root, 0x38bdf8);
    scene.add(activeBoxHelper);
  }

  // Populate camera selector without overwriting Alembic camera transforms!
  cameraSelect.innerHTML = `<option value="__orbit__">Orbit Viewport</option>`;
  controller.cameras.forEach((cam, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `Alembic: ${cam.name || `Camera_${idx}`}`;
    cameraSelect.appendChild(opt);
  });
  cameraSelect.value = "__orbit__";

  fitOrbitCameraToRoot(controller.root);

  // Update HUD & Timeline Controls
  hudFilename.textContent = fileName;
  hudDescription.textContent =
    subtitle || controller.archive.info.userDescription || controller.archive.info.appName || "Ogawa Alembic Archive";

  timelineSlider.min = String(controller.startTime);
  timelineSlider.max = String(Math.max(controller.endTime, controller.startTime + 0.001));
  timelineSlider.step = String(Math.max(0.0005, (controller.duration || 1) / 1000));
  timelineSlider.value = String(controller.currentTime);
  timelineSlider.disabled = controller.duration <= 1e-6;

  btnPlayToggle.textContent = controller.playing ? "Pause" : "Play";
  readoutRange.textContent = `[${controller.startTime.toFixed(2)}s, ${controller.endTime.toFixed(2)}s]`;
  readoutFps.textContent = String(Math.round(controller.fps * 100) / 100);

  updateSceneMetrics();
  syncTimelineReadout();
  populateInspector(controller.archive);
}

// --- Archive & Hierarchy Inspector ---
function populateInspector(archive) {
  hierarchyTreeEl.innerHTML = "";
  const entries = [];

  const walk = (iobj, depth) => {
    entries.push({
      fullName: iobj.fullName,
      name: iobj.name,
      schemaType: iobj.schemaType,
      isInstance: iobj.isInstanceRoot,
      depth,
    });
    const children = iobj.children();
    for (const c of children) {
      walk(c, depth + 1);
      c.dispose();
    }
  };

  const top = archive.top;
  for (const child of top.children()) {
    walk(child, 0);
    child.dispose();
  }

  treeCountBadge.textContent = `${entries.length} nodes`;

  entries.forEach((entry, idx) => {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = `${8 + entry.depth * 14}px`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "tree-name";
    nameSpan.textContent = entry.isInstance ? `${entry.name} ⇢` : entry.name;

    const tag = document.createElement("span");
    const schemaLabel = entry.schemaType || "Object";
    tag.className = `schema-tag schema-${schemaLabel}`;
    tag.textContent = schemaLabel;

    row.append(nameSpan, tag);
    row.addEventListener("click", () => {
      hierarchyTreeEl.querySelectorAll(".tree-row.is-selected").forEach((el) => {
        el.classList.remove("is-selected");
      });
      row.classList.add("is-selected");
      inspectNodeByPath(archive, entry.fullName);
      activateInspectorTab("details");
    });

    hierarchyTreeEl.appendChild(row);

    // Pre-populate details with the first interesting schema node
    if (idx === 0) {
      row.classList.add("is-selected");
      inspectNodeByPath(archive, entry.fullName);
    }
  });

  // Archive Metadata
  const info = archive.info;
  archiveMetaGrid.innerHTML = "";
  appendKvRow(archiveMetaGrid, "Core Format", archive.coreType);
  appendKvRow(archiveMetaGrid, "Archive Version", String(info.archiveVersion));
  appendKvRow(archiveMetaGrid, "Application", info.appName || "—");
  appendKvRow(archiveMetaGrid, "Date Written", info.dateWritten || "—");
  appendKvRow(archiveMetaGrid, "Description", info.userDescription || "—");
  appendKvRow(archiveMetaGrid, "DCC FPS", info.dccFps > 0 ? String(info.dccFps) : "Auto");

  // TimeSamplings
  timeSamplingsList.innerHTML = "";
  archive.getTimeSamplings().forEach((ts, idx) => {
    appendKvRow(
      timeSamplingsList,
      `TS #${idx} (${ts.kind})`,
      `${ts.maxNumSamples} samples @ ${ts.fps > 0 ? `${Math.round(ts.fps * 10) / 10} fps` : "static"}`
    );
  });

  echoOutput.textContent = archive.echo();
}

function appendKvRow(container, key, value) {
  const row = document.createElement("div");
  row.className = "kv-item";
  const k = document.createElement("span");
  k.className = "kv-key";
  k.textContent = key;
  const v = document.createElement("span");
  v.className = "kv-val";
  v.textContent = value;
  row.append(k, v);
  container.appendChild(row);
}

function varianceLabel(v) {
  if (v === TopologyVariance.Constant) return "Constant";
  if (v === TopologyVariance.Homogeneous) return "Homogeneous (Fixed Topo)";
  if (v === TopologyVariance.Heterogeneous) return "Heterogeneous (Dynamic Topo)";
  return String(v);
}

function inspectNodeByPath(archive, fullPath) {
  if (archive.isClosed) return;
  const obj = archive.findObject(fullPath);
  if (!obj) return;

  try {
    selectedNodeTitle.textContent = obj.name;
    const schemaLabel = obj.schemaType || "Object";
    selectedNodeSchema.textContent = schemaLabel;
    selectedNodeSchema.className = `schema-tag schema-${schemaLabel}`;

    nodeDetailsBody.innerHTML = "";
    const metaBox = document.createElement("div");
    metaBox.className = "kv-list";
    appendKvRow(metaBox, "Full Path", obj.fullName);
    appendKvRow(metaBox, "Schema String", obj.schemaString || "(untyped)");
    appendKvRow(metaBox, "Children", String(obj.numChildren));
    if (obj.isInstanceRoot) {
      appendKvRow(metaBox, "Instance Source", obj.instanceSourcePath);
    }
    const matAssign = obj.getMaterialAssignmentPath();
    if (matAssign) {
      appendKvRow(metaBox, "Assigned Material", matAssign);
    }

    // Schema-specific summary
    const schema = obj.asSchema();
    if (schema) {
      try {
        if ("numSamples" in schema) {
          appendKvRow(metaBox, "Samples", String(schema.numSamples));
        }
        if ("topologyVariance" in schema) {
          appendKvRow(metaBox, "Topology", varianceLabel(schema.topologyVariance));
        }
        if (schema.kind === "PolyMesh") {
          appendKvRow(
            metaBox,
            "FaceSets",
            schema.getFaceSetNames().join(", ") || "None"
          );
        } else if (schema.kind === "Camera" && schema.numSamples > 0) {
          const s = schema.getSample(0);
          appendKvRow(metaBox, "Focal Length", `${s.focalLength.toFixed(2)} mm`);
          appendKvRow(
            metaBox,
            "Aperture (H×V)",
            `${s.horizontalAperture.toFixed(2)} × ${s.verticalAperture.toFixed(2)} cm`
          );
        }
      } finally {
        schema.dispose();
      }
    }

    nodeDetailsBody.appendChild(metaBox);

    // List Compound / Scalar / Array Property Headers
    const props = obj.getProperties();
    try {
      const renderCompoundSummary = (compound, prefix = "") => {
        for (const hdr of compound.getHeaders()) {
          const fullPropName = prefix ? `${prefix}/${hdr.name}` : hdr.name;
          const card = document.createElement("div");
          card.className = "prop-card";

          const title = document.createElement("div");
          title.className = "prop-card-title";
          title.textContent = fullPropName;

          const sub = document.createElement("div");
          sub.className = "prop-card-sub";
          if (hdr.isCompound) {
            sub.textContent = `CompoundProperty • schema="${hdr.metaData.schema || "—"}"`;
            card.append(title, sub);
            nodeDetailsBody.appendChild(card);

            const subComp = compound.getCompound(hdr.name);
            try {
              if (prefix.split("/").length < 2) {
                renderCompoundSummary(subComp, fullPropName);
              }
            } finally {
              subComp.dispose();
            }
          } else {
            const kindStr = hdr.isScalar ? "Scalar" : "Array";
            const dtStr = `${podName(hdr.dataType.pod)}[${hdr.dataType.extent}]`;
            const interp = hdr.interpretation ? ` (${hdr.interpretation})` : "";
            sub.textContent = `${kindStr} • ${dtStr}${interp}`;
            card.append(title, sub);
            nodeDetailsBody.appendChild(card);
          }
        }
      };

      renderCompoundSummary(props);
    } finally {
      props.dispose();
    }
  } finally {
    obj.dispose();
  }
}

// --- Inspector Tabs ---
function activateInspectorTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.getElementById("tab-hierarchy").hidden = tabName !== "hierarchy";
  document.getElementById("tab-details").hidden = tabName !== "details";
  document.getElementById("tab-archive").hidden = tabName !== "archive";
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateInspectorTab(btn.dataset.tab));
});

// --- UI Event Listeners ---
DEMO_PRESETS.forEach((preset) => {
  const opt = document.createElement("option");
  opt.value = preset.id;
  opt.textContent = preset.label;
  presetSelect.appendChild(opt);
});

presetSelect.addEventListener("change", async () => {
  const preset = DEMO_PRESETS.find((p) => p.id === presetSelect.value) || DEMO_PRESETS[0];
  showToast(`Generating ${preset.label} in WASM…`);
  const t0 = performance.now();
  const { fileName, bytes } = await generateProceduralAbc(preset.id);
  const dt = (performance.now() - t0).toFixed(1);
  await loadAbcBuffer(bytes, fileName, preset.description);
  showToast(`Authored & loaded ${fileName} (${formatBytes(bytes.byteLength)}) in ${dt} ms`);
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  await loadAbcBuffer(buf, file.name, `Local file (${formatBytes(buf.byteLength)})`);
  showToast(`Loaded ${file.name}`);
  fileInput.value = "";
});

// Drag & Drop .abc support
viewportPane.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropOverlay.hidden = false;
});
viewportPane.addEventListener("dragleave", (e) => {
  if (e.target === viewportPane || e.target === canvas) {
    dropOverlay.hidden = true;
  }
});
viewportPane.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropOverlay.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  await loadAbcBuffer(buf, file.name, `Dropped file (${formatBytes(buf.byteLength)})`);
  showToast(`Loaded ${file.name}`);
});

// Export current Three.js scene to .abc file download
async function exportCurrentSceneBytes() {
  if (!activeController) return null;
  const ctrl = activeController;
  const wasPlaying = ctrl.playing;
  ctrl.pause();

  const hasAnim = ctrl.duration > 1e-6;
  const bytes = await exporter.parseAsync(ctrl.root, {
    appName: "alembic-wasm Studio Exporter",
    description: `Exported from ${currentFileName}`,
    fps: ctrl.fps,
    frameRange: hasAnim
      ? { startTime: ctrl.startTime, endTime: ctrl.endTime, fps: ctrl.fps }
      : undefined,
    sampleDeformingMeshes:
      ctrl.homogeneousMeshBindings.length > 0 || ctrl.subdBindings.length > 0,
    evaluateFrame: hasAnim ? (t) => ctrl.setTime(t) : undefined,
  });

  ctrl.playing = wasPlaying;
  return bytes;
}

btnExportAbc.addEventListener("click", async () => {
  if (!activeController) return;
  showToast("Exporting Three.js scene to Ogawa .abc…");
  const bytes = await exportCurrentSceneBytes();
  if (!bytes) return;
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = currentFileName.replace(/\.abc$/i, "") + "_exported.abc";
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${a.download} (${formatBytes(bytes.byteLength)})`);
});

btnRoundtrip.addEventListener("click", async () => {
  if (!activeController) return;
  const t0 = performance.now();
  const bytes = await exportCurrentSceneBytes();
  if (!bytes) return;
  const rtName = currentFileName.replace(/\.abc$/i, "") + "_roundtrip.abc";
  await loadAbcBuffer(
    bytes,
    rtName,
    "Round-trip verified: Three.js scene -> ABCExporter (WASM OArchive) -> ABCLoader (WASM IArchive)"
  );
  const elapsed = (performance.now() - t0).toFixed(1);
  showToast(`Round-trip succeeded (${formatBytes(bytes.byteLength)} in ${elapsed} ms)`);
});

cameraSelect.addEventListener("change", () => {
  if (!activeController || cameraSelect.value === "__orbit__") {
    activeCamera = orbitCamera;
    controls.enabled = true;
    handleResize();
    return;
  }
  const camIdx = Number(cameraSelect.value);
  const abcCam = activeController.cameras[camIdx];
  if (abcCam) {
    activeCamera = abcCam;
    controls.enabled = false;
    handleResize();
  }
});

btnFitView.addEventListener("click", () => {
  if (!activeController) return;
  cameraSelect.value = "__orbit__";
  activeCamera = orbitCamera;
  controls.enabled = true;
  fitOrbitCameraToRoot(activeController.root);
});

btnWireframe.addEventListener("click", () => {
  wireframeEnabled = !wireframeEnabled;
  btnWireframe.classList.toggle("is-active", wireframeEnabled);
  btnWireframe.setAttribute("aria-pressed", String(wireframeEnabled));
  if (activeController) {
    applyWireframeMode(activeController.root, wireframeEnabled);
  }
});

btnBounds.addEventListener("click", () => {
  boundsEnabled = !boundsEnabled;
  btnBounds.classList.toggle("is-active", boundsEnabled);
  btnBounds.setAttribute("aria-pressed", String(boundsEnabled));
  if (activeBoxHelper) {
    scene.remove(activeBoxHelper);
    activeBoxHelper.dispose();
    activeBoxHelper = null;
  }
  if (boundsEnabled && activeController) {
    activeBoxHelper = new THREE.BoxHelper(activeController.root, 0x38bdf8);
    scene.add(activeBoxHelper);
  }
});

btnGrid.addEventListener("click", () => {
  gridHelper.visible = !gridHelper.visible;
  btnGrid.classList.toggle("is-active", gridHelper.visible);
  btnGrid.setAttribute("aria-pressed", String(gridHelper.visible));
});

btnRefreshEcho.addEventListener("click", () => {
  if (activeController && !activeController.archive.isClosed) {
    echoOutput.textContent = activeController.archive.echo();
  }
});

// --- Timeline Controls ---
btnPlayToggle.addEventListener("click", () => {
  if (!activeController) return;
  activeController.playing = !activeController.playing;
  btnPlayToggle.textContent = activeController.playing ? "Pause" : "Play";
});

btnStepPrev.addEventListener("click", () => {
  if (!activeController) return;
  activeController.pause();
  btnPlayToggle.textContent = "Play";
  activeController.setFrame(Math.max(0, activeController.currentFrame - 1));
  syncTimelineReadout();
  if (activeController.heterogeneousMeshBindings.length > 0) updateSceneMetrics();
});

btnStepNext.addEventListener("click", () => {
  if (!activeController) return;
  activeController.pause();
  btnPlayToggle.textContent = "Play";
  activeController.setFrame(
    Math.min(activeController.frameCount - 1, activeController.currentFrame + 1)
  );
  syncTimelineReadout();
  if (activeController.heterogeneousMeshBindings.length > 0) updateSceneMetrics();
});

timelineSlider.addEventListener("pointerdown", () => {
  isScrubbing = true;
});
window.addEventListener("pointerup", () => {
  isScrubbing = false;
});
timelineSlider.addEventListener("input", () => {
  if (!activeController) return;
  activeController.pause();
  btnPlayToggle.textContent = "Play";
  activeController.setTime(Number(timelineSlider.value));
  syncTimelineReadout();
  if (activeController.heterogeneousMeshBindings.length > 0) updateSceneMetrics();
});

interpSelect.addEventListener("change", () => {
  if (!activeController) return;
  activeController.interpolation = interpSelect.value;
  activeController.setTime(activeController.currentTime);
});

speedSelect.addEventListener("change", () => {
  if (!activeController) return;
  activeController.playbackRate = Number(speedSelect.value) || 1.0;
});

chkAdvect.addEventListener("change", () => {
  if (!activeController) return;
  activeController.useVelocityAdvection = chkAdvect.checked;
  activeController.setTime(activeController.currentTime);
});

chkLoop.addEventListener("change", () => {
  if (!activeController) return;
  activeController.loop = chkLoop.checked;
});

function syncTimelineReadout() {
  if (!activeController) return;
  if (!isScrubbing) {
    timelineSlider.value = String(activeController.currentTime);
  }
  readoutTime.textContent = `${activeController.currentTime.toFixed(3)}s`;
  readoutFrame.textContent = `${activeController.currentFrame} / ${Math.max(
    1,
    activeController.frameCount - 1
  )}`;
}

// --- Main Render Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (activeController && activeController.playing) {
    activeController.update(dt);
    syncTimelineReadout();
    if (activeController.heterogeneousMeshBindings.length > 0) {
      updateSceneMetrics();
    }
  }

  if (activeBoxHelper) {
    activeBoxHelper.update();
  }

  if (controls.enabled) {
    controls.update();
  }

  renderer.render(scene, activeCamera);
}

// --- Bootstrap ---
(async function bootstrap() {
  try {
    await initAlembic();
    const ver = getLibraryVersionShort();
    wasmVersionBadge.textContent = `Alembic ${ver} • Ogawa WASM`;

    const defaultPreset = DEMO_PRESETS[0];
    presetSelect.value = defaultPreset.id;
    const { fileName, bytes } = await generateProceduralAbc(defaultPreset.id);
    await loadAbcBuffer(bytes, fileName, defaultPreset.description);
    animate();
  } catch (err) {
    console.error("Bootstrap error:", err);
    wasmVersionBadge.textContent = "WASM Error";
    hudDescription.textContent = err instanceof Error ? err.message : String(err);
  }
})();
