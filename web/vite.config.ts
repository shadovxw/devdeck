import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Go server (air) listens on 7070; the Vite dev server proxies /api and /ws to it
// so the browser only ever talks to one origin.
const api = "http://127.0.0.1:7070";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": api,
      "/ws": { target: api, ws: true },
    },
  },
});
