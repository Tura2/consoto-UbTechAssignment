import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In development, Vite serves the UI and forwards /api to the Node server (same PORT as .env).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, ".."), "");
  return {
    plugins: [react()],
    server: { port: 5173, proxy: { "/api": `http://localhost:${env.PORT || 3000}` } },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
