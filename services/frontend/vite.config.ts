import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend address behind the dev-proxy is overridable via env so a
// developer can point at a backend running on a non-default port without
// touching this file — default matches the backend's contracted port
// (task-003 report: HOST 127.0.0.1, PORT 3001).
const backendTarget = process.env.VITE_BACKEND_ORIGIN ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        // Backend routes live at the root (e.g. /health), not under /api —
        // the proxy strips the prefix so `/api/health` reaches `/health`.
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    // See src/testSetup.ts's own comment: jsdom is missing two Range
    // methods CodeMirror (task 015's SQL editor) relies on.
    setupFiles: ["./src/testSetup.ts"],
  },
});
