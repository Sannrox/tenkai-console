import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base: one build works at `/ui/` and at `/<prefix>/ui/` behind a proxy.
// `pnpm dev` proxies API calls to a local tenkai-server (TENKAI_URL).
const tenkai = process.env.TENKAI_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", assetsDir: "assets" },
  server: {
    proxy: { "/v1": tenkai, "/healthz": tenkai },
  },
});
