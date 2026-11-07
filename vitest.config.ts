import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
  resolve: {
    alias: {
      "@dtv/contracts": new URL(
        "./packages/contracts/src/index.ts",
        import.meta.url,
      ).pathname,
      "@dtv/sdk": new URL("./packages/sdk/src/index.ts", import.meta.url)
        .pathname,
    },
  },
});
