import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir, platform, arch, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { summarizeSamples } from "./performance-metrics.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const samplesIndex = args.indexOf("--samples");
const samples = samplesIndex >= 0 ? Number(args[samplesIndex + 1]) : 5;
const outputIndex = args.indexOf("--out");
const outputPath =
  outputIndex >= 0
    ? resolve(args[outputIndex + 1])
    : resolve(
        root,
        `work/performance-baseline-${new Date().toISOString().replaceAll(":", "-")}.json`,
      );
if (!Number.isInteger(samples) || samples < 1 || samples > 20)
  throw new Error("--samples 必须在 1 到 20 之间");

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.once("listening", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}
async function waitFor(url, child, logs) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：${logs()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* wait for boot */
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`等待服务超时：${url}\n${logs()}`);
}
function start(command, commandArgs, env) {
  const child = spawn(command, commandArgs, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log = (log + chunk.toString()).slice(-8000);
  });
  child.stderr.on("data", (chunk) => {
    log = (log + chunk.toString()).slice(-8000);
  });
  child.logs = () => log;
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 4000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
const dataDir = await mkdtemp(join(tmpdir(), "dtv-perf-"));
const apiPort = await freePort();
let webPort = await freePort();
while (webPort === apiPort) webPort = await freePort();
const base = `http://127.0.0.1:${webPort}`;
let apiProcess;
let webProcess;
let browser;
try {
  const env = {
    ...process.env,
    PORT: String(apiPort),
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    DATABASE_URL: "",
    PGHOST: "",
    AUTH_USERS_FILE: "",
    DEMO_ENABLED: "true",
    DEPLOYMENT_MODE: "demo",
    DTV_API_TARGET: `http://127.0.0.1:${apiPort}`,
  };
  apiProcess = start(
    process.execPath,
    ["--import", "tsx", "apps/core-api/src/main.ts"],
    env,
  );
  await waitFor(
    `http://127.0.0.1:${apiPort}/api/health`,
    apiProcess,
    apiProcess.logs,
  );
  webProcess = start(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "apps/web",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    env,
  );
  await waitFor(base, webProcess, webProcess.logs);
  browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const raw = [];
  const gltfPositions = new Float32Array([-10, 0, 0, 10, 0, 0, 0, 0, 30]);
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [
      {
        uri: `data:application/octet-stream;base64,${Buffer.from(gltfPositions.buffer).toString("base64")}`,
        byteLength: gltfPositions.byteLength,
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: gltfPositions.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-10, 0, 0],
        max: [10, 0, 30],
      },
    ],
  };
  for (let sample = 1; sample <= samples; sample++) {
    process.stderr.write(`性能采样 ${sample}/${samples}\n`);
    const page = await browser.newPage();
    const timings = {};
    let started = performance.now();
    await page.goto(base, { waitUntil: "domcontentloaded" });
    timings.pageDomContentLoadedMs = performance.now() - started;
    started = performance.now();
    await page.getByRole("button", { name: "进入演示系统" }).click();
    await page
      .locator("canvas")
      .first()
      .waitFor({ state: "visible", timeout: 60000 });
    await page
      .getByText("未配置内网天地图")
      .waitFor({ state: "visible", timeout: 60000 });
    timings.mapReadyMs = performance.now() - started;
    started = performance.now();
    await page.getByRole("switch", { name: "气温实况" }).click();
    await page
      .locator('[data-layer="temperature"]')
      .waitFor({ state: "attached" });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-layer="temperature"]')
          ?.getAttribute("data-status") === "on",
    );
    timings.temperatureLayerMs = performance.now() - started;
    await page
      .locator(".side-navigation")
      .getByRole("button", { name: "点位管理" })
      .click();
    await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "管理/上传模型" });
    const modelName = `基线模型-${sample}`;
    await modal.getByLabel("模型名称", { exact: true }).fill(modelName);
    await modal.getByLabel("模型文件（GLB / GLTF）").setInputFiles({
      name: `baseline-${sample}.gltf`,
      mimeType: "model/gltf+json",
      buffer: Buffer.from(JSON.stringify(gltf)),
    });
    started = performance.now();
    const upload = page.waitForResponse(
      (response) =>
        response.url().includes("/api/scenes/xian/files") &&
        response.request().method() === "POST",
    );
    await modal.getByRole("button", { name: "登记模型", exact: true }).click();
    const uploaded = await upload;
    if (!uploaded.ok())
      throw new Error(`模型上传失败：HTTP ${uploaded.status()}`);
    await modal
      .getByText(modelName, { exact: true })
      .waitFor({ state: "visible" });
    timings.modelUploadMs = performance.now() - started;
    started = performance.now();
    const modelFetch = page.waitForResponse(
      (response) =>
        /\/api\/scenes\/xian\/files\/[^/]+$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "GET",
    );
    await modal.getByRole("button", { name: "地图预览", exact: true }).click();
    const fetchedModel = await modelFetch;
    if (!fetchedModel.ok())
      throw new Error(`模型预览读取失败：HTTP ${fetchedModel.status()}`);
    await modal
      .locator(".model-preview-canvas canvas")
      .waitFor({ state: "visible", timeout: 60000 });
    timings.modelPreviewReadyMs = performance.now() - started;
    raw.push(timings);
    await page.close();
  }
  const metricNames = Object.keys(raw[0]);
  const metrics = Object.fromEntries(
    metricNames.map((name) => [
      name,
      summarizeSamples(raw.map((item) => item[name])),
    ]),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "mock-isolated-development",
    sampleCount: samples,
    environment: {
      platform: platform(),
      osRelease: release(),
      architecture: arch(),
      node: process.version,
      browser: browser.version(),
    },
    metricDefinitions: {
      pageDomContentLoadedMs: "页面 DOMContentLoaded",
      mapReadyMs: "演示登录点击至 Cesium 画布及底图状态就绪",
      temperatureLayerMs: "气温图层启用至 Cesium 图层状态 on",
      modelUploadMs: "提交固定小型 GLTF 至服务端接收且登记可见",
      modelPreviewReadyMs: "地图预览点击至模型二进制读取完成且预览画布就绪",
    },
    rawSamples: raw,
    summary: metrics,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  const table = Object.entries(metrics)
    .map(
      ([name, value]) =>
        `| ${name} | ${value.count} | ${value.p50.toFixed(1)} | ${value.p95.toFixed(1)} | ${value.min.toFixed(1)} | ${value.max.toFixed(1)} |`,
    )
    .join("\n");
  await writeFile(
    markdownPath,
    `# 本地 Mock 性能基线\n\n- 生成时间：${report.generatedAt}\n- 模式：${report.mode}\n- 平台：${report.environment.platform} ${report.environment.architecture} (${report.environment.osRelease})\n- 浏览器：Chromium ${report.environment.browser}\n- 样本数：${samples}\n\n| 场景 | 样本 | p50 ms | p95 ms | 最小 ms | 最大 ms |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${table}\n\n> p95 使用 nearest-rank；样本少于 20 时接近最大值。本报告适合与同一机器、浏览器、Mock 数据和构建条件下的后续运行对比，不作为跨机器门槛。\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({ json: outputPath, markdown: markdownPath, summary: metrics }, null, 2)}\n`,
  );
} finally {
  await browser?.close();
  await stop(webProcess);
  await stop(apiProcess);
  await rm(dataDir, { recursive: true, force: true });
}
