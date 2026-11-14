# `alembic-wasm` 项目说明 (AGENTS.md)

## 项目定位

`alembic-wasm` 是面向浏览器、Web Worker 与 Node.js 的完整 **Alembic (`.abc` Ogawa 1.8.x) WebAssembly 读写导出层与强类型 TypeScript SDK**，同时通过子路径 `alembic-wasm/three` 提供无侵入的 **Three.js 插件**（`ABCLoader`、`AlembicSceneController`、`AnimationClipBuilder`、`ABCExporter`、`ABCCurve`）。

## 目录结构

- `xmake.lua` — 根目录 C++17 + Emscripten (`embind`) WebAssembly 构建配置（产物自动输出至 `src/wasm/generated/`）。
- `package.json` & `tsconfig.json` — 纯净的 `"alembic-wasm"` npm 发布包配置（纯 `tsc` 构建至 `dist/`，根级无任何前端框架或 Vite 打包器耦合）。
- `src/` — C++ 与 TypeScript 统一源码目录：
  - `src/cpp/` — C++17 源码与头文件：
    - `src/cpp/include/abc_wasm/` — 零二次拷贝内存流、异常转换、通用动态类型属性/`GeomParam`、全量 Schema 包装与网格细分/焊接加速核头文件。
    - `src/cpp/bind_*.cpp` — 模块化拆分的 7 个 Embind 绑定编译单元（Core/Layer、Objects/Echo、Properties/GeomParam、Xform/Camera/Light、PolyMesh/SubD/FaceSet、Curves/Points/NuPatch、Material/Collections）。
  - `src/index.ts` — 主入口 `"alembic-wasm"`（零框架依赖核心 SDK）。
  - `src/wasm/` — 跨平台 WASM 加载器、`WasmScratchArena` 线性缓冲复用器、Embind 类型定义与 `generated/` 编译产物。
  - `src/core/` — `IArchive`/`OArchive`/分层归档、`TimeSampling`、`IObject`/`OObject`、通用 `Properties`、`IGeomParam`/`OGeomParam` 及 11 类标准 Schema。
  - `src/three/` — 子入口 `"alembic-wasm/three"`（`three` 为可选 `peerDependency`）。
- `tests/` — 基于真实 WASM 运行时的 Vitest 端到端测试套件。
- `example/` — 独立的纯 **HTML + CSS + Vanilla JS** 交互式三维示例工程（自带独立 `example/package.json` 与开发服务器配置，与根库解耦）。

## 常用命令

1. 编译 C++ WASM 模块（需安装 `xmake` 与 `emscripten`）：
   ```bash
   npm run build:wasm
   ```
2. 类型检查与单元测试：
   ```bash
   npm run typecheck
   npm test
   ```
3. 构建 npm 发布产物（纯 `tsc` 输出至 `dist/`）：
   ```bash
   npm run build:ts
   ```
4. 启动独立原生 HTML + JS 示例开发服务器：
   ```bash
   cd example && npm install && npm run dev
   ```
