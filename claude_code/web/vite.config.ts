import { defineConfig } from "vite";

// Ingress serves the SPA under an arbitrary base path, so all asset URLs must be
// relative (base: './'). The dev proxy lets `npm run dev -w web` talk to a
// locally running server on :8099.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8099",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:8099",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
