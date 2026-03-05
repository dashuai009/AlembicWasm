<script setup lang="ts">
import ABCViewer from './components/ABCViewer.vue'
</script>

<template>
  <div class="app-container">
    <ABCViewer />
  </div>
</template>

<style>
.app-container {
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>

