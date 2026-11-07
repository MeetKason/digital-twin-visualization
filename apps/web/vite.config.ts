import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(
  new URL("../../node_modules/cesium/Build/Cesium", import.meta.url),
);
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ["Assets", "Workers", "ThirdParty", "Widgets"].map((dir) => ({
        src: `${root}/${dir}`,
        dest: "cesium",
      })),
    }),
  ],
  optimizeDeps: { include: ["cesium", "react", "react-dom/client", "zod"] },
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium/") },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
