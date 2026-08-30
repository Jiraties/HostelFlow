import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    // Direct demo deployments are self-contained and never need asset requests
    // outside the generated HTML/CSS/JS bundle.
    assetsInlineLimit: mode === "demo" ? Number.MAX_SAFE_INTEGER : undefined,
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
}));
