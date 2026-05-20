import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "client",
  envDir: repoRoot,
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true
  },
  server: {
    port: 3028,
    strictPort: true
  }
});
