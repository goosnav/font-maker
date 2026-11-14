import { defineConfig } from "vite";
export default defineConfig({
  build: { target: "es2022", outDir: "app/static", emptyOutDir: true },
  worker: { format: "es" },
  server: { host: "127.0.0.1" },
});
