<template>
  <div class="viewer-container">
    <canvas ref="canvasRef" />
    <div class="controls">
      <input type="file" @change="handleFileUpload" accept=".abc" id="abcFileInput" />
      <label for="abcFileInput" class="file-label">Choose ABC File</label>
      <button @click="resetScene" class="reset-btn">Reset Scene</button>

      <div class="camera-selector">
        <label for="cameraSelect">Camera:</label>
        <select id="cameraSelect" v-model="selectedCameraName" @change="switchCamera">
          <option v-for="cam in availableCameras" :key="cam.name" :value="cam.name">
            {{ cam.name }}
          </option>
        </select>
      </div>

      <div class="animation-controls" v-if="currentModel">
        <button @click="toggleAnimation" class="anim-btn" :class="{ playing: isAnimationPlaying }">
          {{ isAnimationPlaying ? 'Pause' : 'Play' }}
        </button>
        <button @click="resetAnimation" class="anim-btn">Reset</button>
        <div class="speed-control">
          <label for="speedSlider">Speed:</label>
          <input
            type="range"
            id="speedSlider"
            v-model="animationSpeed"
            min="0.1"
            max="3"
            step="0.1"
            :disabled="!currentModel"
          />
          <span>{{ animationSpeed }}x</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import ABCLoader from '../loaders/ABCLoader';

const canvasRef = ref<HTMLCanvasElement>();

const availableCameras = ref<THREE.PerspectiveCamera[]>([]);
const selectedCameraName = ref<string>('');

const isAnimationPlaying = ref<boolean>(true);
const animationSpeed = ref<number>(1.0);

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let loader: ABCLoader;
let currentModel: THREE.Group | null = null;
let defaultCamera: THREE.PerspectiveCamera;

// ====== 主循环相关（全局唯一）======
let rafId = 0;
let lastTime = 0;
let animatedMeshes: THREE.Mesh[] = [];

function rebuildAnimatedMeshes(root: THREE.Object3D | null) {
  animatedMeshes = [];
  if (!root) return;

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.animationFrames) {
      obj.userData.isPlaying = true;
      animatedMeshes.push(obj);
    }
  });

  // UI 状态：只要当前模型里存在动画网格，就默认允许播放按钮控制
  isAnimationPlaying.value = true;
  // console.log(`Found ${animatedMeshes.length} animated meshes`);
}
// let abcTime = 0;

function mainLoop(t: number) {
  rafId = requestAnimationFrame(mainLoop);

  const time = t / 1000;
  const dt = lastTime ? (time - lastTime) : 0;
  lastTime = time;
//  abcTime += dt * animationSpeed.value;
  controls?.update();

  // 推进点缓存动画（统一在主循环里做）
  const speed = animationSpeed.value;
  for (const mesh of animatedMeshes) {
    if (mesh.userData.isPlaying) {
      (loader as ABCLoader).applyAnimationFrame(mesh, dt * speed);
      (loader as ABCLoader).setAnimationSpeed(mesh, speed);
      // loader.applyAnimationAtTime(mesh, abcTime); // 注意：传绝对时间，不传 dt
    }
  }

  // 每帧明确清屏，避免残影
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
}

const initScene = () => {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  defaultCamera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  defaultCamera.name = 'Default Camera';
  defaultCamera.position.z = 5;

  camera = defaultCamera;

  availableCameras.value = [defaultCamera];
  selectedCameraName.value = defaultCamera.name;

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value as HTMLCanvasElement,
    antialias: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // 手动清屏（配合 clear）
  renderer.autoClear = false;
  renderer.clear(true, true, true);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;
  controls.maxPolarAngle = Math.PI;

  loader = new ABCLoader();

  window.addEventListener('resize', handleResize);

  // 启动唯一主循环
  cancelAnimationFrame(rafId);
  lastTime = 0;
  rafId = requestAnimationFrame(mainLoop);
};

const handleResize = () => {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

const handleFileUpload = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file && file.name.toLowerCase().endsWith('.abc')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (buffer) loadABCModel(buffer);
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert('Please select a valid .abc file');
  }
};

const loadABCModel = async (buffer: ArrayBuffer) => {
  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }

  if (!loader) loader = new ABCLoader();

  try {
    const model = await loader.processDataAsync(buffer);
    currentModel = model;
    scene.add(currentModel);

    collectCamerasFromModel(model);
    fitCameraToModel(model);

    // 关键：只收集动画网格，不再启动第二个 RAF
    rebuildAnimatedMeshes(model);

    console.log('ABC model loaded successfully');
  } catch (error) {
    console.error('Error loading ABC model:', error);
    alert('Error loading ABC model: ' + (error as Error).message);
  }
};

const collectCamerasFromModel = (model: THREE.Group) => {
  const cameras: THREE.PerspectiveCamera[] = [defaultCamera];

  model.traverse((object) => {
    if (object instanceof THREE.PerspectiveCamera) {
      if (!object.name) object.name = `Camera_${cameras.length}`;
      cameras.push(object);
      console.log(`Found camera: ${object.name}`);
    }
  });

  availableCameras.value = cameras;

  const sceneCamera = cameras.length > 1 ? cameras[1] : null;
  if (sceneCamera) {
    selectedCameraName.value = sceneCamera.name;
    switchCamera();
  } else {
    selectedCameraName.value = defaultCamera.name;
  }

  console.log(`Total cameras available: ${cameras.length}`);
};

const switchCamera = () => {
  const selectedCamera = availableCameras.value.find(
    (cam) => cam.name === selectedCameraName.value
  );

  if (!selectedCamera) {
    console.warn('Selected camera not found');
    return;
  }

  camera = selectedCamera;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  if (controls) controls.dispose();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;
  controls.maxPolarAngle = Math.PI;

  if (selectedCamera !== defaultCamera) {
    const cameraWorldPosition = new THREE.Vector3();
    selectedCamera.getWorldPosition(cameraWorldPosition);

    const cameraDirection = new THREE.Vector3();
    selectedCamera.getWorldDirection(cameraDirection);

    const targetDistance = 10;
    controls.target.copy(cameraWorldPosition).add(cameraDirection.multiplyScalar(targetDistance));
  }

  controls.update();
  console.log(`Switched to camera: ${selectedCamera.name}`);
};

const fitCameraToModel = (model: THREE.Object3D) => {
  if (!camera || !renderer || !controls) {
    console.warn('Camera, renderer, or controls not initialized, cannot fit camera to model');
    return;
  }

  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    console.warn('Model bounding box is empty, using default camera position');
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
  cameraDistance *= 1.5;

  const direction = new THREE.Vector3(1, 0.5, 1).normalize();
  camera.position.copy(center).add(direction.multiplyScalar(cameraDistance));
  camera.lookAt(center);

  controls.target.copy(center);
  controls.update();

  camera.near = cameraDistance / 100;
  camera.far = cameraDistance * 100;
  camera.updateProjectionMatrix();
};

const resetScene = () => {
  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }

  availableCameras.value = [defaultCamera];
  selectedCameraName.value = defaultCamera.name;
  camera = defaultCamera;

  if (controls) controls.dispose();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;
  controls.maxPolarAngle = Math.PI;
  controls.target.set(0, 0, 0);
  controls.update();

  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0x00aaff, wireframe: true });
  const sphere = new THREE.Mesh(geometry, material);

  const group = new THREE.Group();
  group.add(sphere);
  scene.add(group);
  currentModel = group;

  rebuildAnimatedMeshes(currentModel);
};

// 动画控制（只改 mesh.userData.isPlaying）
const toggleAnimation = () => {
  if (!currentModel) return;

  const next = !isAnimationPlaying.value;
  currentModel.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.animationFrames) {
      obj.userData.isPlaying = next;
      (loader as ABCLoader).setAnimationPlaying(obj, next);
    }
  });

  isAnimationPlaying.value = next;
};

const resetAnimation = () => {
  if (!currentModel) return;
  currentModel.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.animationFrames) {
      obj.userData.animationCurrentTime = 0;
      obj.userData.currentFrame = 0;
    }
  });
};

onMounted(() => {
  initScene();
  resetScene();
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', handleResize);
  controls?.dispose();
  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }
});
</script>


<style scoped>
.viewer-container {
  width: 100%;
  height: 100vh;
  position: relative;
}

canvas {
  display: block;
}

.controls {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 10;
  display: flex;
  gap: 10px;
  align-items: center;
}

input[type="file"] {
  display: none;
}

.file-label {
  display: inline-block;
  padding: 8px 16px;
  background: #42b983;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.3s;
}

.file-label:hover {
  background: #359c6d;
}

.reset-btn {
  padding: 8px 16px;
  background: #646cff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.3s;
}

.reset-btn:hover {
  background: #5a61d4;
}

.camera-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px 12px;
  border-radius: 4px;
}

.camera-selector label {
  color: white;
  font-size: 14px;
}

.camera-selector select {
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: #333;
  color: white;
  font-size: 14px;
  cursor: pointer;
  min-width: 150px;
}

.camera-selector select:hover {
  background: #444;
}

.camera-selector select:focus {
  outline: 2px solid #42b983;
  outline-offset: 1px;
}

.animation-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px 12px;
  border-radius: 4px;
  flex-wrap: wrap;
}

.anim-btn {
  padding: 6px 12px;
  background: #646cff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.3s;
}

.anim-btn:hover {
  background: #5a61d4;
}

.anim-btn.playing {
  background: #42b983;
}

.anim-btn.playing:hover {
  background: #359c6d;
}

.speed-control {
  display: flex;
  align-items: center;
  gap: 6px;
  color: white;
  font-size: 14px;
}

.speed-control input[type="range"] {
  width: 80px;
}

.speed-control span {
  min-width: 30px;
  text-align: center;
}
</style>