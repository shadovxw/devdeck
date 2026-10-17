import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The Go server (air) listens on 7070; the Vite dev server proxies /api and /ws to it
// so the browser only ever talks to one origin.
const api = "http://127.0.0.1:7070";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // changeOrigin rewrites Host to the Go server's, which its Host check requires.
    // The browser's Origin (this dev server) is allowed via DEVDECK_EXTRA_ORIGINS.
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/ws": { target: api, changeOrigin: true, ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
