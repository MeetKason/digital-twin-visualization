import { test, expect } from "@playwright/test";
test("登录、地图、图层、透明度、搜索、时次和地区切换", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(r.url()) &&
      /^https?:/.test(r.url())
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "数字孪生可视化系统" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/login.png" });
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("未配置内网天地图")).toBeVisible();
  await page.getByRole("switch", { name: "气温实况" }).click();
  await expect(page.locator('[data-layer="temperature"]')).toHaveAttribute(
    "data-status",
    "on",
  );
  await page.getByLabel("选中图层透明度").fill("35");
  await expect(page.getByText("35%")).toBeVisible();
  await page.getByPlaceholder("搜索图层 / 站点 / 坐标").fill("西安");
  await expect(
    page.getByRole("button", { name: /西安演示站/ }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /西安演示站/ })
    .first()
    .click();
  await expect(page.getByText("站点观测详情")).toBeVisible();
  await page.getByRole("button", { name: "关闭站点详情" }).click();
  await page.getByPlaceholder("搜索图层 / 站点 / 坐标").fill("");
  await page.getByLabel("气象时次").fill("4");
  await expect(page.locator(".time-context")).toContainText("04:00");
  await page.getByRole("button", { name: "基础图层", exact: true }).click();
  await page.getByRole("button", { name: "收起图层面板" }).click();
  await page.getByRole("button", { name: "打开图层面板" }).click();
  await expect(page.locator('[data-layer="boundary"]')).toBeVisible();
  await page.getByRole("button", { name: "气象要素", exact: true }).click();
  await expect(page.locator('[data-layer="temperature"]')).toHaveAttribute(
    "data-status",
    "on",
  );
  await page.screenshot({ path: "test-results/workbench-xian.png" });
  await page.getByLabel("地区场景").selectOption("taiyuan");
  await expect(page.locator("header")).toContainText("太原市");
  await expect(page.getByText("站点观测详情")).toHaveCount(0);
  await expect(page.getByText("未配置内网天地图")).toBeVisible();
  await page.getByPlaceholder("搜索图层 / 站点 / 坐标").fill("太原演示站");
  await expect(
    page.getByRole("button", { name: /太原演示站/ }).first(),
  ).toBeVisible();
  await page.getByPlaceholder("搜索图层 / 站点 / 坐标").fill("");
  await page.screenshot({ path: "test-results/workbench.png" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator(".timeline")).toBeVisible();
  await page.screenshot({ path: "test-results/workbench-1366.png" });
  expect(external).toEqual([]);
});
test("API 拒绝未知场景和缺失时次", async ({ request }) => {
  await request.post("/api/auth/demo", { headers: { "X-DTV-Request": "1" } });
  expect((await request.get("/api/scenes/invalid/layers")).status()).toBe(404);
  expect(
    (
      await request.get(
        "/api/layers/temperature/data?sceneId=xian&time=2099-01-01T00:00:00Z",
      )
    ).status(),
  ).toBe(404);
});

test("独立 ESM 插件注册和卸载站点详情插槽", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60000 });
  await page.getByPlaceholder("搜索图层 / 站点 / 坐标").fill("西安演示站");
  await page
    .getByRole("button", { name: /西安演示站/ })
    .first()
    .click();
  await page.getByRole("button", { name: "加载示例插件" }).click();
  await expect(page.getByText("客户扩展示例", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "卸载示例插件" }).click();
  await expect(page.getByText("客户扩展示例", { exact: true })).toHaveCount(0);
});

test("按菜单：工具书签、漫游方案、点位录入与刷新、专题和管理", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("switch", { name: "气温实况" }).click();
  await page.getByRole("button", { name: "工具箱", exact: true }).click();
  await page.getByRole("button", { name: "保存视角", exact: true }).click();
  await page.getByLabel("视角名称").fill("验收镜头");
  await page.getByRole("button", { name: "保存书签" }).click();
  await page.getByRole("button", { name: "雨景模拟" }).click();
  await expect(page.getByLabel("雨景模拟")).toBeVisible();
  await page.getByRole("button", { name: "雪景模拟" }).click();
  await expect(page.getByLabel("雨景模拟")).toHaveCount(0);
  await page.screenshot({ path: "test-results/menu-tools.png" });
  await page.getByRole("button", { name: "关闭模拟" }).click();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "路径漫游" })
    .click();
  await page.getByRole("button", { name: "新建方案", exact: true }).click();
  await page.getByLabel("漫游方案名称").fill("验收路线");
  await page.getByRole("button", { name: "从站点添加" }).click();
  await page.getByRole("button", { name: /添加 西安演示站 1/ }).click();
  await page.getByRole("button", { name: "保存方案", exact: true }).click();
  await page.getByRole("button", { name: "开始漫游", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停漫游" })).toBeVisible();
  await page.getByRole("button", { name: "暂停漫游" }).click();
  await expect(page.getByRole("button", { name: "继续漫游" })).toBeVisible();
  await page.screenshot({ path: "test-results/menu-cruise.png" });
  await page.getByRole("button", { name: "停止漫游" }).click();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "点位管理" })
    .click();
  await page.getByRole("button", { name: "录入站点", exact: true }).click();
  await page
    .getByRole("dialog", { name: "录入站点" })
    .getByLabel("站点名称", { exact: true })
    .fill("新增验收站");
  await page
    .getByRole("dialog", { name: "录入站点" })
    .getByLabel("点位编码", { exact: true })
    .fill("QA-001");
  await page
    .getByRole("dialog", { name: "录入站点" })
    .getByLabel("经度(°)", { exact: true })
    .fill("108.8");
  await page
    .getByRole("dialog", { name: "录入站点" })
    .getByLabel("纬度(°)", { exact: true })
    .fill("34.3");
  await page.getByRole("button", { name: "保存站点", exact: true }).click();
  await expect(page.getByRole("button", { name: /新增验收站/ })).toBeVisible();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "总览地图" })
    .click();
  await page.getByRole("button", { name: "打开图层面板" }).click();
  await expect(page.locator('[data-layer="temperature"]')).toHaveAttribute(
    "data-status",
    "on",
  );
  await page.getByPlaceholder("搜索图层 / 站点 / 坐标").fill("QA-001");
  await expect(page.getByRole("button", { name: /新增验收站/ })).toBeVisible();
  await page.screenshot({ path: "test-results/menu-map-search.png" });
  await expect(page.getByText("服务端已保存", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "点位管理" })
    .click();
  await expect(page.getByRole("button", { name: /新增验收站/ })).toBeVisible();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "气象专题" })
    .click();
  await page.getByRole("button", { name: "低温雨雪冰冻", exact: true }).click();
  await expect(page.getByText("最低温度", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/menu-weather.png" });
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "设备监控" })
    .click();
  await expect(
    page.getByText("设备数据源未接入", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "系统管理" })
    .click();
  await page.getByRole("button", { name: "新增演示用户" }).click();
  await page.getByLabel("用户名称").fill("验收用户");
  await page.getByRole("button", { name: "保存用户" }).click();
  await expect(page.getByText("验收用户", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/menu-settings.png" });
});

test("切换漫游方案取消未完成的地图选点", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.getByText("未配置内网天地图")).toBeVisible();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "路径漫游" })
    .click();
  await page.getByRole("button", { name: "新建方案", exact: true }).click();
  await page.getByLabel("漫游方案名称").fill("方案A");
  await page.getByRole("button", { name: "地图选点", exact: true }).click();
  await page.getByRole("button", { name: "新建方案", exact: true }).click();
  await page.getByLabel("漫游方案名称").fill("方案B");
  await page.locator("canvas").click({ position: { x: 700, y: 350 } });
  await page
    .locator(".cruise-library")
    .getByRole("button", { name: /方案A/ })
    .click();
  await expect(page.locator(".cruise-point")).toHaveCount(0);
});

test("空间测量结束与清除、坐标定位校验", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.getByText("未配置内网天地图")).toBeVisible();
  await page.getByRole("button", { name: "工具箱", exact: true }).click();
  await page.getByRole("button", { name: "面积测量", exact: true }).click();
  for (const point of [
    { x: 650, y: 300 },
    { x: 750, y: 300 },
    { x: 700, y: 400 },
  ])
    await page.locator("canvas").click({ position: point });
  await page
    .locator("canvas")
    .click({ button: "right", position: { x: 700, y: 400 } });
  await expect(page.getByText(/测量结束 · 3 点/)).toBeVisible();
  await page.getByRole("button", { name: "清除测量" }).click();
  await expect(page.getByText(/测量结束/)).toHaveCount(0);
  await page.getByRole("button", { name: "经纬度定位", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "经纬度定位" });
  await dialog.getByLabel("经度（°）").fill("999");
  await dialog.getByLabel("纬度（°）").fill("34");
  await dialog.getByRole("button", { name: "确定定位" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("经度（°）").fill("108.94");
  await dialog.getByRole("button", { name: "确定定位" }).click();
  await expect(dialog).toHaveCount(0);
});

test("服务器模型上传、跨浏览器预览、引用保护与场景隔离", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const positions = new Float32Array([-10, 0, 0, 10, 0, 0, 0, 0, 30]);
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0, 0.5, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    buffers: [
      {
        uri:
          "data:application/octet-stream;base64," +
          Buffer.from(positions.buffer).toString("base64"),
        byteLength: positions.byteLength,
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
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
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.getByText("未配置内网天地图")).toBeVisible();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "点位管理" })
    .click();
  await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "管理/上传模型" });
  await modal.getByLabel("模型名称", { exact: true }).fill("验收模型");
  await modal.getByLabel("模型文件（GLB / GLTF）").setInputFiles({
    name: "triangle.gltf",
    mimeType: "model/gltf+json",
    buffer: Buffer.from(JSON.stringify(gltf)),
  });
  await modal.getByRole("button", { name: "登记模型", exact: true }).click();
  await expect(modal.getByText("验收模型", { exact: true })).toBeVisible();
  await expect(page.getByText("服务端已保存", { exact: true })).toBeVisible();
  const state = await (
    await page.request.get("/api/scenes/xian/business")
  ).json();
  expect(
    state.data.assets.find((a: { name: string }) => a.name === "验收模型")
      .blobId,
  ).toMatch(/^srv_/);
  // Share only the session cookie: this context has no IndexedDB/localStorage files.
  const otherContext = await page.context().browser()!.newContext();
  try {
    await otherContext.addCookies(await page.context().cookies());
    const other = await otherContext.newPage();
    await other.goto("http://127.0.0.1:5173/");
    await other
      .locator(".side-navigation")
      .getByRole("button", { name: "点位管理" })
      .click();
    await other.getByRole("button", { name: "上传/绑定", exact: true }).click();
    const sharedModal = other.getByRole("dialog", { name: "管理/上传模型" });
    const response = other.waitForResponse(
      (r) => r.url().includes("/files/srv_") && r.request().method() === "GET",
    );
    await sharedModal
      .getByRole("button", { name: "地图预览", exact: true })
      .click();
    expect((await response).status()).toBe(200);
    await expect(
      sharedModal.locator(".model-preview-canvas canvas"),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
  await modal.getByRole("button", { name: "地图预览", exact: true }).click();
  await expect(modal.locator(".model-preview-canvas canvas")).toBeVisible();
  await modal.screenshot({ path: "test-results/menu-model.png" });
  await modal.getByRole("button", { name: "绑定", exact: true }).click();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.screenshot({ path: "test-results/menu-station.png" });
  await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
  await modal.getByRole("button", { name: "删除", exact: true }).click();
  await expect(
    modal.getByText("模型已被站点或方案引用，不能删除"),
  ).toBeVisible();
  await modal.getByRole("button", { name: "关闭管理/上传模型" }).click();
  await page.getByLabel("地区场景").selectOption("taiyuan");
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "点位管理" })
    .click();
  await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
  await expect(modal.getByText("验收模型", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("开发文件服务不得暴露服务端私有存储", async ({ request }) => {
  const { resolve } = await import("node:path");
  const path = resolve("apps/core-api/.data/platform.json");
  expect((await request.get("/@fs" + path)).status()).toBe(403);
  expect(
    (await request.get("/@fs" + path.replace("/.data/", "/.DATA/"))).status(),
  ).toBe(403);
});

test("文件保存失败清理、删除重试与旧浏览器文件迁移", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "点位管理" })
    .click();
  await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "管理/上传模型" });
  const model = JSON.stringify({
    asset: { version: "2.0" },
    scenes: [{ nodes: [] }],
    scene: 0,
  });
  await page.route("**/api/scenes/xian/business", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: "模拟并发冲突" }),
      });
    else await route.continue();
  });
  await modal.getByLabel("模型名称", { exact: true }).fill("失败模型");
  await modal.getByLabel("模型文件（GLB / GLTF）").setInputFiles({
    name: "failed.gltf",
    mimeType: "model/gltf+json",
    buffer: Buffer.from(model),
  });
  await modal.getByRole("button", { name: "登记模型", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("资料未保存");
  expect(
    await (await page.request.get("/api/scenes/xian/files")).json(),
  ).toEqual([]);
  await page.unroute("**/api/scenes/xian/business");
  const uploaded = await page.request.post("/api/scenes/xian/files", {
    headers: {
      "X-DTV-Request": "1",
      "Content-Type": "application/octet-stream",
      "X-File-Name": "retry.pdf",
    },
    data: Buffer.from("%PDF-1.7 retry"),
  });
  expect(uploaded.status()).toBe(201);
  const { id } = await uploaded.json();
  await modal.getByRole("button", { name: "查看未关联文件" }).click();
  await expect(modal.getByText(/retry.pdf/)).toBeVisible();
  await page.route(`**/files/${id}`, async (route) => {
    if (route.request().method() === "DELETE")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "暂时离线" }),
      });
    else await route.continue();
  });
  await modal.getByRole("button", { name: "清理文件" }).click();
  await expect(modal.getByText(/暂时离线/)).toBeVisible();
  await page.unroute(`**/files/${id}`);
  await modal.getByRole("button", { name: "清理文件" }).click();
  await expect(modal.getByText("没有未关联文件")).toBeVisible();
  expect(
    (await page.request.get(`/api/scenes/xian/files/${id}`)).status(),
  ).toBe(404);
  const legacyId = "legacy-browser-file";
  await page.evaluate(
    async ({ model, legacyId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("dtv-files-v1", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("files");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put(new File([model], "legacy.gltf"), legacyId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { model, legacyId },
  );
  const old = await (
    await page.request.get("/api/scenes/xian/business")
  ).json();
  old.data.assets.push({
    id: "legacy-model",
    name: "旧模型",
    kind: "model",
    blobId: legacyId,
    fileName: "legacy.gltf",
    size: Buffer.byteLength(model),
  });
  expect(
    (
      await page.request.put("/api/scenes/xian/business", {
        headers: { "X-DTV-Request": "1" },
        data: old,
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "点位管理" })
    .click();
  await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
  await modal.getByRole("button", { name: "迁移到服务器" }).click();
  await expect(modal.getByText(/legacy.gltf · 服务器文件/)).toBeVisible();
  await expect(page.getByText("服务端已保存", { exact: true })).toBeVisible();
  const migrated = await (
    await page.request.get("/api/scenes/xian/business")
  ).json();
  const asset = migrated.data.assets.find(
    (a: { id: string }) => a.id === "legacy-model",
  );
  expect(
    await (
      await page.request.get(`/api/scenes/xian/files/${asset.blobId}`)
    ).text(),
  ).toBe(model);
});

test("采集补数、入库预览、空时次和地图时间轴联动", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "系统管理" })
    .click();
  await page.getByRole("button", { name: "站点数据", exact: true }).click();
  const panel = page.getByRole("region", { name: "采集与补数管理" });
  await expect(panel.getByText("暂无采集任务")).toBeVisible();
  await panel.getByRole("checkbox", { name: "使用入库观测" }).click();
  await expect(
    panel.getByRole("checkbox", { name: "使用入库观测" }),
  ).toBeChecked();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "总览地图" })
    .click();
  await expect(page.getByText("暂无入库时次", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放时间轴" })).toBeDisabled();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "系统管理" })
    .click();
  await page.getByRole("button", { name: "站点数据", exact: true }).click();
  await panel.getByLabel("补数开始（北京时间）").fill("2026-11-07T02:00");
  await panel.getByLabel("补数结束（北京时间）").fill("2026-11-07T04:00");
  await panel.getByRole("button", { name: "提交补数任务" }).click();
  await expect(panel.getByText("已完成", { exact: true })).toBeVisible();
  await expect(panel.getByText("3/3 小时", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "预览最近入库时次" }).click();
  await expect(panel.getByLabel("入库数据预览")).toContainText("入库观测");
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/layers/temperature/data") &&
      r.request().method() === "GET",
  );
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "总览地图" })
    .click();
  await page.getByRole("switch", { name: "气温实况" }).click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByText("入库时次 · Mock", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "播放时间轴" })).toBeEnabled();
  expect(await page.locator(".time-ticks button").allTextContents()).toEqual([
    "02:00",
    "03:00",
    "04:00",
  ]);
  await page.getByRole("button", { name: "04:00", exact: true }).click();
  const added = await page.request.post("/api/scenes/xian/ingestion/jobs", {
    headers: { "X-DTV-Request": "1" },
    data: {
      source: "mock",
      startTime: "2026-11-07T01:00:00+08:00",
      endTime: "2026-11-07T01:00:00+08:00",
    },
  });
  expect(added.status()).toBe(201);
  await expect(page.locator(".time-ticks button")).toHaveCount(4, {
    timeout: 9000,
  });
  await expect(page.locator(".time-context")).toContainText("2026-11-07 04:00");
  await page.reload();
  await expect(
    page.getByText("入库时次 · Mock", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("地区场景").selectOption("taiyuan");
  await expect(
    page.getByText("2026-11-07 · 固定演示时次", { exact: true }),
  ).toBeVisible();
});

test("时次接口短暂失败后自动恢复", async ({ page }) => {
  let fail = true;
  await page.route("**/layers/temperature/times?*", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "临时不可用" }),
      });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".time-ticks button")).toHaveCount(13, {
    timeout: 9000,
  });
  await expect(page.getByText(/时次读取失败：/)).toHaveCount(0);
});

test("时次接口慢于轮询周期时仍可完成加载", async ({ page }) => {
  await page.route("**/layers/temperature/times?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".time-ticks button")).toHaveCount(13, {
    timeout: 10000,
  });
});
