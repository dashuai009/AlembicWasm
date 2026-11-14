import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

export default defineConfig({
  root: __dirname,
  base: "./",
  resolve: {
    alias: [
      {
        find: /^alembic-wasm\/three$/,
        replacement: resolve(repoRoot, "src/three/index.ts"),
      },
      {
        find: /^alembic-wasm$/,
        replacement: resolve(repoRoot, "src/index.ts"),
      },
    ],
  },
  assetsInclude: ["**/*.wasm", "**/*.abc"],
  optimizeDeps: {
    exclude: ["alembic-wasm"],
  },
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    target: "es2022",
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
