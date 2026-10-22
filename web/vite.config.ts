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
    port: 5174,
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
    testTimeout: 15_000,
    // `npm run test:coverage` writes coverage/lcov.info, which the Sonar workflow reads.
    // Not counted: tests themselves, the copied shadcn components, the entry file.
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/components/ui/**", "src/main.tsx", "src/**/*.d.ts"],
    },
  },
});
