import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Web dev server proxies /api and /data to the Express server so the browser
// talks to a single origin. /data serves audioPath/imagePath files (see
// packages/server/src/app.ts) — without it, <img>/<audio> src="/data/..."
// falls through to Vite's SPA fallback (200 text/html) instead of the file.
// Server port matches packages/server config default (3001).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/data": "http://localhost:3001",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
