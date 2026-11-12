#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

/** 离线检查只读取打包产物和部署配置，不访问公网或读取任何凭据。 */
const repo = resolve(import.meta.dirname, "..");
const configPath = resolve(process.argv[2] ?? join(repo, "deploy/config.json"));
const webRoot = resolve(process.argv[3] ?? join(repo, "apps/web/dist"));
const problems = [];
const requireFile = (path, label) => {
  if (!existsSync(path)) problems.push(`${label}缺失：${path}`);
};
const localPath = (value, label) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    problems.push(`${label}必须使用同源绝对路径`);
    return null;
  }
  return value;
};

requireFile(configPath, "部署配置");
requireFile(join(webRoot, "index.html"), "Web入口");
for (const resource of ["cesium/Assets", "cesium/Workers", "cesium/Widgets"]) {
  requireFile(join(webRoot, resource), `Cesium ${resource}`);
}

if (existsSync(join(webRoot, "index.html"))) {
  const html = readFileSync(join(webRoot, "index.html"), "utf8");
  for (const match of html.matchAll(/(?:src|href)="(\/[^"?]+)"/g)) {
    requireFile(join(webRoot, match[1]), `入口资源 ${match[1]}`);
  }
}

if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const basemap = config.basemap;
  if (basemap?.type !== "xyz") {
    problems.push("底图必须配置为本地 xyz；当前天地图或其他在线底图不能通过断公网验收");
  } else {
    const url = localPath(basemap.url, "底图 URL");
    if (url) requireFile(join(webRoot, url.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0")), "零级底图瓦片");
  }
  if (config.terrainUrl) {
    const url = localPath(config.terrainUrl, "地形 URL");
    if (url) requireFile(join(webRoot, url, "layer.json"), "地形 layer.json");
  } else {
    problems.push("未配置本地地形；地图虽可回退椭球，但不满足三维地形离线验收");
  }
}

if (problems.length) {
  console.error(`离线地图检查未通过（${problems.length}项）：\n${problems.map((p) => `- ${p}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("离线地图静态检查通过；仍需在断公网环境验证浏览器请求和地图渲染。");
}
