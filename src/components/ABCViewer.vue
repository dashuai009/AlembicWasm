<template>
  <div class="viewer-container">
    <canvas ref="canvasRef" />
    <div class="controls">
      <input
        type="file"
        @change="handleFileUpload"
        accept=".abc"
        id="abcFileInput"
      />
      <label for="abcFileInput" class="file-label">Choose ABC File</label>
      <button @click="resetScene" class="reset-btn">Reset Scene</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import ABCLoader from '../loaders/ABCLoader';

const canvasRef = ref<HTMLCanvasElement>();

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let loader: ABCLoader;
let currentModel: THREE.Group | null = null;

const initScene = () => {
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  // Create camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 5;

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

  // Rotate scene slightly if no model is loaded
  if (!currentModel) {
    scene.rotation.y += 0.005;
  }

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

const loadABCModel = (buffer: ArrayBuffer) => {
  // Remove existing model if present
  if (currentModel) {
    scene.remove(currentModel);
  }

  try {
    // Parse the buffer directly
    const model = loader.parse(buffer);
    currentModel = model;
    scene.add(currentModel);

    console.log('ABC model loaded successfully');
  } catch (error) {
    console.error('Error loading ABC model:', error);
    alert('Error loading ABC model: ' + (error as Error).message);
  }
};

const resetScene = () => {
  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }

  // Add back a simple object to show the scene is working
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    wireframe: true
  });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);
  currentModel = sphere;
};

onMounted(() => {
  initScene();
  // Add initial object to the scene
  resetScene();
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
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
</style>