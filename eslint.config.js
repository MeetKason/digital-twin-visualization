import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
export default ts.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "apps/web/dist/**",
      "apps/web/public/cesium/**",
      // iconfont平台导出的压缩资源，保持原始供应文件，不作为手写源码检查。
      "apps/web/public/iconfont.js",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
);
