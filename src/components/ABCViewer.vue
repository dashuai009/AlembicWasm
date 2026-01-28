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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import ABCLoader from '../loaders/ABCLoader';

const canvasRef = ref<HTMLCanvasElement>();

// 相机列表和当前选中的相机
const availableCameras = ref<THREE.PerspectiveCamera[]>([]);
const selectedCameraName = ref<string>('');

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let loader: ABCLoader;
let currentModel: THREE.Group | null = null;
let defaultCamera: THREE.PerspectiveCamera; // 默认相机

const initScene = () => {
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  // Create default camera
  defaultCamera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  defaultCamera.name = 'Default Camera';
  defaultCamera.position.z = 5;
  
  // 设置当前相机为默认相机
  camera = defaultCamera;
  
  // 初始化相机列表
  availableCameras.value = [defaultCamera];
  selectedCameraName.value = defaultCamera.name;

  // Create renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value as HTMLCanvasElement,
    antialias: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Add lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);

  // Initialize OrbitControls for mouse interaction
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;
  controls.maxPolarAngle = Math.PI;

  // Initialize loader
  loader = new ABCLoader();

  // Add event listener for window resize
  window.addEventListener('resize', handleResize);

  // Start animation loop
  animate();
};

const handleResize = () => {
  if (!camera || !renderer) return;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

const animate = () => {
  requestAnimationFrame(animate);

  // Update controls
  controls.update();

  renderer.render(scene, camera);
};

const handleFileUpload = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file && file.name.toLowerCase().endsWith('.abc')) {
    const reader = new FileReader();

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (buffer) {
        loadABCModel(buffer);
      }
    };

    reader.readAsArrayBuffer(file);
  } else {
    alert('Please select a valid .abc file');
  }
};

const loadABCModel = async (buffer: ArrayBuffer) => {
  // Remove existing model if present
  if (currentModel) {
    scene.remove(currentModel);
  }

  try {
    // Use the async processDataAsync method to parse ABC data with WASM
    const model = await loader.processDataAsync(buffer);
    currentModel = model;
    scene.add(currentModel);
    
    // 收集场景中的所有相机
    collectCamerasFromModel(model);
    
    // 根据导入的场景设置相机
    fitCameraToModel(model);
    
    console.log('ABC model loaded successfully');
  } catch (error) {
    console.error('Error loading ABC model:', error);
    alert('Error loading ABC model: ' + (error as Error).message);
  }
};

// 从模型中收集所有相机
const collectCamerasFromModel = (model: THREE.Group) => {
  const cameras: THREE.PerspectiveCamera[] = [defaultCamera];
  
  // 递归遍历模型，查找所有相机
  model.traverse((object) => {
    if (object instanceof THREE.PerspectiveCamera) {
      // 确保相机有唯一的名称
      if (!object.name) {
        object.name = `Camera_${cameras.length}`;
      }
      cameras.push(object);
      console.log(`Found camera: ${object.name}`);
    }
  });
  
  availableCameras.value = cameras;
  
  // 如果场景中有相机（除了默认相机），自动切换到第一个场景相机
  const sceneCamera = cameras.at(1);
  if (sceneCamera) {
    selectedCameraName.value = sceneCamera.name;
    switchCamera();
  } else {
    selectedCameraName.value = defaultCamera.name;
  }
  
  console.log(`Total cameras available: ${cameras.length}`);
};

// 切换相机
const switchCamera = () => {
  const selectedCamera = availableCameras.value.find(
    cam => cam.name === selectedCameraName.value
  );
  
  if (!selectedCamera) {
    console.warn('Selected camera not found');
    return;
  }
  
  camera = selectedCamera;
  
  // 更新相机的宽高比
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  
  // 重新创建 OrbitControls 以使用新相机
  if (controls) {
    controls.dispose();
  }
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;
  controls.maxPolarAngle = Math.PI;
  
  // 如果是场景中的相机，需要获取其世界位置作为控制目标
  if (selectedCamera !== defaultCamera) {
    // 获取相机的世界位置
    const cameraWorldPosition = new THREE.Vector3();
    selectedCamera.getWorldPosition(cameraWorldPosition);
    
    // 获取相机的朝向
    const cameraDirection = new THREE.Vector3();
    selectedCamera.getWorldDirection(cameraDirection);
    
    // 设置控制目标为相机前方一定距离的点
    const targetDistance = 10;
    controls.target.copy(cameraWorldPosition).add(cameraDirection.multiplyScalar(targetDistance));
  }
  
  controls.update();
  
  console.log(`Switched to camera: ${selectedCamera.name}`);
};

const fitCameraToModel = (model: THREE.Group) => {
  // 计算模型的包围盒
  const box = new THREE.Box3().setFromObject(model);
  
  // 检查包围盒是否有效
  if (box.isEmpty()) {
    console.warn('Model bounding box is empty, using default camera position');
    return;
  }
  
  // 获取包围盒的中心和尺寸
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // 计算包围盒的最大维度
  const maxDim = Math.max(size.x, size.y, size.z);
  
  // 根据相机视角计算合适的距离
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
  
  // 添加一些边距，确保模型完全可见
  cameraDistance *= 1.5;
  
  // 设置相机位置（从斜上方观察）
  const direction = new THREE.Vector3(1, 0.5, 1).normalize();
  camera.position.copy(center).add(direction.multiplyScalar(cameraDistance));
  
  // 让相机看向模型中心
  camera.lookAt(center);
  
  // 更新 OrbitControls 的目标点
  controls.target.copy(center);
  controls.update();
  
  // 更新相机的近裁剪面和远裁剪面
  camera.near = cameraDistance / 100;
  camera.far = cameraDistance * 100;
  camera.updateProjectionMatrix();
  
  console.log('Camera fitted to model:', {
    center: center.toArray(),
    size: size.toArray(),
    cameraDistance
  });
};

const resetScene = () => {
  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }

  // 重置相机列表，只保留默认相机
  availableCameras.value = [defaultCamera];
  selectedCameraName.value = defaultCamera.name;
  camera = defaultCamera;
  
  // 重新创建 OrbitControls 以使用默认相机
  if (controls) {
    controls.dispose();
  }
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;
  controls.maxPolarAngle = Math.PI;
  controls.target.set(0, 0, 0);
  controls.update();

  // Add back a simple object to show the scene is working
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    wireframe: true
  });
  const sphere = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(sphere);
  scene.add(group);
  currentModel = group;
};

onMounted(() => {
  initScene();
  // Add initial object to the scene
  resetScene();
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  controls.dispose();
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
</style>