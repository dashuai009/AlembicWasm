# 这个项目是做什么的？

**ABC文件加载器项目**是一个专门用于在Web浏览器中加载、解析和可视化Alembic(.abc)文件的现代化JavaScript/TypeScript库。它将Vue3前端与WebAssembly(WASM)后端技术结合，以高性能地处理复杂的三维几何和动画数据。


#  项目结构

前端测试项目在项目根目录下，是个vue3的项目
  - src/loaders/ABCLoader.ts - 核心加载器实现，负责将WebAssembly后端和Three.js前端连接
  - src/components/ABCViewer.vue - Vue组件，包含简单处理文件上传和3D显示逻辑
  
alembic库的WebAssembly模块在AbcWASM目录下
  - AbcWASM/alembic_echo.cpp - WebAssembly核心代码，处理Alembic文件解析
  - AbcWASM/xmake.lua - 构建配置文件

# 如何调试这个项目

前端测试项目
1. 安装依赖 `npm install`
2. 启动开发服务器 `npm run dev`
alembic库的WebAssembly模块
1. 安装依赖 `xrepo install alembic`
2. 查看xmake配置，确保xmake配了emcc的工具链：`xmake -f -v -D`
3. 构建WASM模块：`xmake build`


# 测试资产

暂时是 AbcWASM/lion_skeleton.abc 这个资产