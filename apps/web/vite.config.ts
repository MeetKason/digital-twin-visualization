import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/.[dD][aA][tT][aA]/**",
        "**/[dD][eE][pP][lL][oO][yY]/[aA][uU][tT][hH]/**",
        "**/*.dump",
        ...(process.env.AUTH_USERS_FILE
          ? [resolve(process.env.AUTH_USERS_FILE)]
          : []),
      ],
    },
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
