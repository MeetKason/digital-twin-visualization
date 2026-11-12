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
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
  await page.getByRole("switch", { name: "气温实况" }).click();
  await expect(page.locator('[data-layer="temperature"]')).toHaveAttribute(
    "data-status",
    "on",
  );
  const radarData = page.waitForResponse((response) =>
    response.url().includes("/layers/radar/data") && response.request().method() === "GET",
  );
  await page.getByRole("switch", { name: "雷达回波" }).click();
  expect((await radarData).status()).toBe(200);
  await expect(page.locator('[data-layer="radar"]')).toHaveAttribute("data-status", "on");
  const satelliteData = page.waitForResponse((response) =>
    response.url().includes("/layers/satellite/data") && response.request().method() === "GET",
  );
  await page.getByRole("switch", { name: "卫星云图" }).click();
  expect((await satelliteData).status()).toBe(200);
  await expect(page.locator('[data-layer="satellite"]')).toHaveAttribute("data-status", "on");
  const opacity = page.getByRole("slider", { name: "选中图层透明度" });
  const rail = page.locator(".opacity-control .ant-slider");
  const bounds = (await rail.boundingBox())!;
  await rail.click({ position: { x: bounds.width * 0.35, y: bounds.height / 2 } });
  await expect(opacity).toHaveAttribute("aria-valuenow", "35");
  await opacity.press("ArrowLeft");
  await expect(opacity).toHaveAttribute("aria-valuenow", "34");
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
  await page.getByRole("button", { name: "04:00", exact: true }).click();
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
  await page.getByRole("combobox", { name: "地区场景" }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("太原市场景", { exact: true }).click();
  await expect(page.locator("header")).toContainText("太原市");
  await expect(page.getByText("站点观测详情")).toHaveCount(0);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
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
  const sandbox = page.locator('iframe[title^="已隔离插件"]');
  await expect(sandbox).toHaveCount(1);
  expect(await sandbox.getAttribute("sandbox")).toBe("allow-scripts");
  expect(await sandbox.getAttribute("srcdoc")).toContain("connect-src 'none'");
  await page.getByRole("button", { name: "卸载示例插件" }).click();
  await expect(page.getByText("客户扩展示例", { exact: true })).toHaveCount(0);
  await expect(sandbox).toHaveCount(0);
});

test("插件入口哈希不匹配时拒绝安装", async ({ page }) => {
  await page.route("**/extensions/example/index.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "export default { manifest: { id: 'tampered' } };",
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page.locator("canvas").waitFor({ state: "visible" });
  await page.getByPlaceholder("搜索图层 / 站点 / 坐标").fill("西安演示站");
  await page
    .getByRole("button", { name: /西安演示站/ })
    .first()
    .click();
  await page.getByRole("button", { name: "加载示例插件" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "插件完整性校验失败" })).toBeVisible();
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
  await page.getByRole("menuitem", { name: /低温雨雪冰冻/ }).click();
  await expect(page.getByText("最低温度", { exact: true })).toBeVisible();
  await expect(page.getByText("仅按页面展示的 Mock 阈值生成站点级提示，不生成正式风险范围或业务预警结论。")).toBeVisible();
  await page.screenshot({ path: "test-results/menu-weather.png" });
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "设备监控" })
    .click();
  await expect(page.getByText("设备监控 · Mock 演示", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Mock 设备遥测清单" }).locator("tbody tr[data-row-key]")).toHaveCount(6);
  await expect(page.getByRole("table", { name: "Mock 设备遥测清单" })).toContainText("模拟心跳");
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "系统管理" })
    .click();
  await expect(page.getByRole("alert").filter({ hasText: "仅真实管理员" })).toBeVisible();
  await page.screenshot({ path: "test-results/menu-settings.png" });
});

test("切换漫游方案取消未完成的地图选点", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
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
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
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
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "点位管理" })
    .click();
  await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "管理/上传模型" });
  await modal.getByLabel("模型名称", { exact: true }).fill("验收模型");
  await modal.locator('input[type="file"]').first().setInputFiles({
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
    await sharedModal.locator(".asset-row").filter({ hasText: "验收模型" })
      .getByRole("button", { name: "地图预览", exact: true })
      .click();
    expect((await response).status()).toBe(200);
    await expect(
      sharedModal.locator(".model-preview-canvas canvas"),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
  await modal.locator(".asset-row").filter({ hasText: "验收模型" }).getByRole("button", { name: "地图预览", exact: true }).click();
  await expect(modal.locator(".model-preview-canvas canvas")).toBeVisible();
  await modal.screenshot({ path: "test-results/menu-model.png" });
  await modal.locator(".asset-row").filter({ hasText: "验收模型" }).getByRole("button", { name: "绑定", exact: true }).click();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.screenshot({ path: "test-results/menu-station.png" });
  await page.getByRole("button", { name: "上传/绑定", exact: true }).click();
  await modal.locator(".asset-row").filter({ hasText: "验收模型" }).getByRole("button", { name: "删除", exact: true }).click();
  await expect(
    modal.getByText("模型已被站点或方案引用，不能删除"),
  ).toBeVisible();
  await modal.getByRole("button", { name: "关闭管理/上传模型" }).click();
  await page.getByRole("combobox", { name: "地区场景" }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("太原市场景", { exact: true }).click();
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
  await modal.locator('input[type="file"]').first().setInputFiles({
    name: "failed.gltf",
    mimeType: "model/gltf+json",
    buffer: Buffer.from(model),
  });
  await modal.getByRole("button", { name: "登记模型", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("资料未保存");
  const retained = await (await page.request.get("/api/scenes/xian/files")).json();
  expect(retained).toHaveLength(3);
  expect(retained.every((file: { referenced: boolean }) => file.referenced)).toBe(true);
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
  test.setTimeout(75000);
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "系统管理" })
    .click();
  await page.getByRole("menuitem", { name: "站点数据", exact: true }).click();
  const panel = page.getByRole("region", { name: "采集与补数管理" });
  await expect(panel.getByText("地面小时观测", { exact: true }).first()).toBeVisible();
  const unsupported = await page.request.post("/api/scenes/xian/ingestion/jobs", {
    headers: { "X-DTV-Request": "1" },
    data: {
      source: "mock",
      productId: "radar-grid",
      startTime: "2026-11-07T00:00:00Z",
      endTime: "2026-11-07T00:00:00Z",
    },
  });
  expect(unsupported.status()).toBe(201);
  await expect.poll(async () => {
    const response = await page.request.get("/api/scenes/xian/ingestion?productId=radar-grid");
    return (await response.json()).jobs[0]?.status;
  }, { timeout: 10000 }).toBe("succeeded");
  await page.request.put("/api/scenes/xian/ingestion/config", {
    headers: { "X-DTV-Request": "1" },
    data: { mode: "ingested", productId: "radar-grid" },
  });
  const radarFrameResponse = await page.request.get("/api/layers/radar/data?sceneId=xian&time=2026-11-07T00%3A00%3A00.000Z");
  expect(radarFrameResponse.status()).toBe(200);
  expect(await radarFrameResponse.json()).toMatchObject({ source: "mock", storage: "ingested", unit: "dBZ" });
  expect((await radarFrameResponse.json()).gridCells).toHaveLength(80);
  await page.request.put("/api/scenes/xian/ingestion/config", {
    headers: { "X-DTV-Request": "1" },
    data: { mode: "demo", productId: "surface-hourly" },
  });
  await expect(panel.getByText("暂无采集任务")).toBeVisible();
  await expect(panel.getByText("暂无采集任务")).toBeVisible();
  await expect(panel.getByLabel("采集健康告警")).toContainText(
    "当前任务范围内未发现缺测或积压告警",
  );
  await panel.getByRole("switch", { name: "使用入库观测" }).click();
  await expect(
    panel.getByRole("switch", { name: "使用入库观测" }),
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
  await page.getByRole("menuitem", { name: "站点数据", exact: true }).click();
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
    timeout: 35000, // 空闲采集状态按30秒刷新，新增外部任务无需恢复高频轮询。
  });
  await expect(page.locator(".time-context")).toContainText("2026-11-07 04:00");
  await page.reload();
  await expect(
    page.getByText("入库时次 · Mock", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "地区场景" }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("太原市场景", { exact: true }).click();
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

test("系统管理显示租户操作审计并支持筛选和导出", async ({ page }) => {
  await page.route("**/api/audit", (route) =>
    route.fulfill({
      json: [
        {
          id: "1",
          tenantId: "demo",
          actor: '=HYPERLINK("https://example.invalid","click")',
          sceneId: "xian",
          action: "auth.login",
          result: "success",
          at: "2026-11-09T01:00:00.000Z",
        },
        {
          id: "2",
          tenantId: "demo",
          actor: "alpha-editor",
          sceneId: "taiyuan",
          action: "business.write",
          result: "denied",
          at: "2026-11-09T00:00:00.000Z",
        },
      ],
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page
    .locator(".side-navigation")
    .getByRole("button", { name: "系统管理" })
    .click();
  await page.getByRole("menuitem", { name: "操作审计" }).click();
  await expect(page.getByText("auth.login", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "结果筛选" }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("成功", { exact: true }).click();
  await expect(page.getByText("business.write", { exact: true })).toHaveCount(
    0,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const csvFile = await download;
  expect(csvFile.suggestedFilename()).toContain("audit.csv");
  const stream = await csvFile.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  expect(csv).toContain("'=HYPERLINK");
});

test("专题与设备使用Ant表格并在窄屏保持表头和滚动区可见", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page.locator(".side-navigation").getByRole("button", { name: "气象专题" }).click();
  await page.getByRole("menuitem", { name: /02.*强对流/ }).click();
  await expect(page.locator(".topic-map-heading")).toContainText("强对流");
  await expect(page.locator(".weather-table .ant-table-tbody tr[data-row-key]")).toHaveCount(6);
  await expect(page.getByRole("columnheader", { name: "有效时次" })).toBeVisible();
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    const panel = await page.locator(".topic-table").boundingBox();
    const body = await page.locator(".weather-table .ant-table-body").boundingBox();
    expect(panel).not.toBeNull();
    expect(body).not.toBeNull();
    expect(body!.y + body!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);
    await expect(page.getByRole("menuitem", { name: /04.*山洪地质灾害/ })).toBeVisible();
    await page.screenshot({ path: `test-results/weather-layout-${viewport.width}.png` });
  }
  await page.locator(".side-navigation").getByRole("button", { name: "设备监控" }).click();
  await expect(page.locator(".device-table .ant-table-tbody tr[data-row-key]").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "最近心跳" })).toBeVisible();
});

test("登录密码图标支持查看隐藏并保留输入内容", async ({ page }) => {
  await page.goto("/");
  const account = page.getByRole("textbox", { name: "账号", exact: true });
  const password = page.getByLabel("密码", { exact: true });
  await account.fill("visibility-demo");
  await password.fill("demo-visibility-only");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "显示", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("demo-visibility-only");
  await page.getByRole("button", { name: "隐藏", exact: true }).press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("demo-visibility-only");
  await password.clear();
  await page.screenshot({ path: "test-results/login-inputs.png" });
});

test("西安行政边界独立加载并在切换时次时复用", async ({ page }) => {
  let boundaryRequests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/geojson/610100.geojson")) boundaryRequests += 1; });
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page.getByRole("button", { name: "基础图层", exact: true }).click();
  await expect(page.locator('[data-layer="boundary"]')).toHaveAttribute("data-status", "on");
  await expect(page.getByText("行政边界", { exact: true })).toBeVisible();
  await expect(page.locator('[data-layer="base-2"]')).toHaveCount(0);
  await expect(page.getByLabel("选中图层透明度")).toHaveCount(0);
  expect(boundaryRequests).toBe(1);
  await page.getByRole("button", { name: "站点图层", exact: true }).click();
  await expect(page.getByLabel("选中图层透明度")).toHaveCount(0);
  await page.getByRole("button", { name: "气象要素", exact: true }).click();
  await expect(page.getByLabel("选中图层透明度")).toBeVisible();
  await page.getByRole("button", { name: "00:00", exact: true }).click();
  await expect(page.locator(".time-context")).toContainText("00:00");
  expect(boundaryRequests).toBe(1);
  await page.screenshot({ path: "test-results/xian-administrative-boundary.png" });
});


test("会话失效后停止采集轮询，重新登录可恢复工作台", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".time-ticks button")).toHaveCount(13);
  await page.locator(".side-navigation").getByRole("button", { name: "系统管理" }).click();
  await page.getByRole("menuitem", { name: "站点数据", exact: true }).click();
  await expect(page.getByText("暂无采集任务")).toBeVisible();
  let calls = 0, writes = 0;
  await page.route("**/api/scenes/xian/ingestion**", (route) => {
    calls++;
    // 由显式写操作触发失效；初始后台读请求继续执行，避免在按钮点击前提前退出。
    if (route.request().method() === "GET") return route.continue();
    writes++;
    return route.fulfill({ status: 401, json: { message: "请先登录" } });
  });
  await page.getByRole("switch", { name: "使用入库观测" }).click();
  await expect(page.getByText("登录已失效，请重新登录。已保存的服务端资料不受影响。")).toBeVisible();
  await expect(page.locator(".application")).toHaveCount(0);
  expect(writes).toBe(1);
  const stopped = calls;
  await page.waitForTimeout(3500); // 跨过活跃轮询周期，确认工作台已卸载且不再重试。
  expect(calls).toBe(stopped);
  await page.unroute("**/api/scenes/xian/ingestion**");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".time-ticks button")).toHaveCount(13);
  await expect(page.locator(".application")).toBeVisible();
});

test("新演示租户预置两条多点路线和三个视角，保存后刷新仍保留", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".application")).toBeVisible();
  const state = await (await page.request.get("/api/scenes/xian/business")).json();
  expect(state.data.plans).toHaveLength(2);
  expect(state.data.bookmarks).toHaveLength(3);
  expect(state.data.plans.every((plan: { points: unknown[] }) => plan.points.length === 3)).toBe(true);
  await page.locator(".side-navigation").getByRole("button", { name: "路径漫游" }).click();
  await page.getByRole("button", { name: /Mock · 西安站点巡检/ }).click();
  await expect(page.locator(".cruise-point")).toHaveCount(3);
  await page.getByRole("button", { name: "保存方案", exact: true }).click();
  await expect(page.getByText("服务端已保存", { exact: true })).toBeVisible();
  await page.reload();
  const saved = await (await page.request.get("/api/scenes/xian/business")).json();
  expect(saved.revision).toBeGreaterThan(0);
  expect(saved.data.plans).toEqual(state.data.plans);
});

test("雷达云图风场使用产品图例，预报显示起报与有效时间并跟随时间轴", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".time-ticks button")).toHaveCount(13);
  for (const name of ["雷达回波", "卫星云图", "风场实况", "精细化预报"]) {
    await page.getByRole("switch", { name, exact: true }).click();
  }
  const legend = page.getByLabel("气象产品图例");
  await expect(legend.getByText(/雷达回波 dBZ/)).toBeVisible();
  await expect(legend.getByText(/箭头指向去向/)).toBeVisible();
  await expect(legend.getByText(/有效 2026-11-07 12:00 · \+12小时/)).toBeVisible();
  await page.getByRole("button", { name: "04:00", exact: true }).click();
  await expect(legend.getByText(/有效 2026-11-07 04:00 · \+4小时/)).toBeVisible();
  const cameraRevision = Number(await page.locator(".map-canvas").getAttribute("data-camera-revision"));
  await legend.getByRole("button", { name: "定位产品范围" }).click();
  await expect.poll(async () => Number(await page.locator(".map-canvas").getAttribute("data-camera-revision"))).toBeGreaterThan(cameraRevision);
  await expect(page.locator(".map-canvas")).toHaveAttribute("aria-busy", "false");
  await page.screenshot({ path: "test-results/weather-products.png" });
  await page.getByRole("switch", { name: "精细化预报", exact: true }).click();
  await page.getByRole("switch", { name: "卫星云图", exact: true }).click();
  await page.screenshot({ path: "test-results/radar-wind.png" });
  await page.getByRole("switch", { name: "雷达回波", exact: true }).click();
  await expect(legend.getByText(/雷达回波 dBZ/)).toHaveCount(0);
});

test("预置演示模型视频PDF可读取，视频能解码播放且其他会话不能访问", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".application")).toBeVisible();
  const state = await (await page.request.get("/api/scenes/xian/business")).json();
  expect(state.data.assets).toHaveLength(3);
  const video = state.data.assets.find((asset: { kind: string }) => asset.kind === "video");
  const pdf = state.data.assets.find((asset: { kind: string }) => asset.kind === "document");
  const response = await page.request.get(`/api/scenes/xian/files/${pdf.blobId}`);
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const other = await browser.newContext();
  try { expect((await other.request.get(`http://127.0.0.1:5173/api/scenes/xian/files/${video.blobId}`)).status()).toBe(401); }
  finally { await other.close(); }
  await page.locator(".side-navigation").getByRole("button", { name: "点位管理" }).click();
  await page.getByRole("button", { name: "播放视频", exact: true }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect.poll(() => page.locator("video").evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.locator("video").evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(640);
});

test("高程请求随快速切换场景取消，重建地图后仅保留一个画布", async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  const terrainRequests: string[] = [];
  let failedTerrain = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/mapservice/swdx")) terrainRequests.push(request.url()); });
  page.on("requestfailed", (request) => { if (request.url().includes("/mapservice/swdx")) failedTerrain++; });
  await page.route("**/api/display-config", (route) => route.fulfill({ json: { tiandituKey: "test-key-not-a-credential", cesiumIonAccessToken: null } }));
  await page.route("https://*.tianditu.gov.cn/**", async (route) => {
    if (route.request().url().includes("/mapservice/swdx")) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const { deflate } = await import("pako");
      const heights = new Int16Array(150 * 150).fill(500);
      await route.fulfill({ body: Buffer.from(deflate(new Uint8Array(heights.buffer))) }).catch(() => {});
    } else await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect.poll(() => terrainRequests.length, { timeout: 15000 }).toBeGreaterThan(0);
  const beforeSwitch = terrainRequests.length;
  for (const scene of ["太原市场景", "成都市场景", "西安市场景"]) {
    await page.getByRole("combobox", { name: "地区场景" }).click();
    await page.locator(".ant-select-dropdown:visible").getByText(scene, { exact: true }).click();
    await expect(page.locator(".cesium-widget canvas")).toHaveCount(1);
  }
  await expect.poll(() => failedTerrain).toBeGreaterThan(0);
  await expect.poll(() => terrainRequests.length, { timeout: 15000 }).toBeGreaterThan(beforeSwitch);
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.getByRole("button", { name: "缩小", exact: true }).click();
  await expect(page.locator(".cesium-widget canvas")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("场景包保存不生效，发布后应用菜单图层主题布局，历史恢复不覆盖在线版本", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await expect(page.locator(".time-ticks button")).toHaveCount(13);
  const originalScene = (await (await page.request.get("/api/scenes")).json())[0];
  const originalBusiness = await (await page.request.get("/api/scenes/xian/business")).json();
  const path = "/api/scenes/xian/scenario-pack";
  expect((await page.request.post(path + "/publish", { headers: { "X-DTV-Request": "1" }, data: { revision: 0 } })).status()).toBe(201);
  await page.locator(".side-navigation").getByRole("button", { name: "系统管理" }).click();
  await page.getByRole("menuitem", { name: "场景包管理", exact: true }).click();
  const manager = page.getByRole("region", { name: "场景包管理", exact: true });
  await manager.getByRole("textbox", { name: "场景名称", exact: true }).fill("西安场景配置验收");
  await manager.getByRole("textbox", { name: "场景版本标识" }).fill("e2e-v1");
  await manager.getByRole("textbox", { name: "场景主色" }).fill("#118877");
  await manager.getByRole("textbox", { name: "导航背景色" }).fill("#23374d");
  await manager.getByRole("spinbutton", { name: "图层面板宽度" }).fill("300");
  await manager.getByRole("spinbutton", { name: "时间轴高度" }).fill("130");
  await manager.getByRole("checkbox", { name: "设备监控", exact: true }).uncheck();
  await manager.getByRole("button", { name: /启用图层/ }).click();
  await manager.getByRole("checkbox", { name: "雷达回波", exact: true }).uncheck();
  await manager.getByRole("button", { name: "保存场景草稿" }).click();
  await expect(manager.getByText("草稿已保存，在线配置尚未改变")).toBeVisible();
  expect((await (await page.request.get("/api/scenes")).json())[0].name).toBe(originalScene.name);
  await expect(page.locator(".side-navigation").getByRole("button", { name: "设备监控" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await manager.getByRole("button", { name: "导出当前草稿" }).click();
  const stream = await (await downloading).createReadStream();
  let text = ""; for await (const chunk of stream) text += chunk.toString();
  expect(JSON.parse(text)).toMatchObject({ formatVersion: 1, scene: { name: "西安场景配置验收" } });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.locator(".settings-page > .panel:last-child > .panel-body").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `test-results/scenario-manager-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await manager.getByRole("button", { name: "发布已保存草稿" }).click();
  await expect(page.locator("header h1")).toContainText("西安场景配置验收");
  await expect(page.locator(".side-navigation").getByRole("button", { name: "设备监控" })).toHaveCount(0);
  await expect(page.locator("header")).toHaveCSS("background-color", "rgb(35, 55, 77)");
  expect((await page.request.get("/api/layers/radar/times?sceneId=xian")).status()).toBe(403);
  await page.locator(".side-navigation").getByRole("button", { name: "总览地图" }).click();
  await expect(page.getByRole("switch", { name: "雷达回波" })).toHaveCount(0);
  await expect(page.locator(".layer-panel")).toHaveCSS("width", "300px");
  await expect(page.locator(".timeline")).toHaveCSS("height", "130px");
  await page.screenshot({ path: "test-results/scenario-published.png" });
  const other = await browser.newContext();
  try {
    await other.request.post("http://127.0.0.1:5173/api/auth/demo", { headers: { "X-DTV-Request": "1" } });
    expect((await (await other.request.get("http://127.0.0.1:5173/api/scenes")).json())[0].name).toBe(originalScene.name);
  } finally { await other.close(); }
  await page.reload();
  await expect(page.locator("header h1")).toContainText("西安场景配置验收");
  await page.locator(".side-navigation").getByRole("button", { name: "系统管理" }).click();
  await page.getByRole("menuitem", { name: "场景包管理", exact: true }).click();
  await manager.locator('tr[data-row-key="1"]').getByRole("button", { name: "恢复为草稿" }).click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "确定", exact: true }).click();
  await expect(manager.getByRole("textbox", { name: "场景名称", exact: true })).toHaveValue(originalScene.name);
  await expect(page.locator("header h1")).toContainText("西安场景配置验收");
  await manager.getByRole("button", { name: "发布已保存草稿" }).click();
  await expect(page.locator("header h1")).toContainText(originalScene.name);
  await expect(page.locator(".side-navigation").getByRole("button", { name: "设备监控" })).toBeVisible();
  expect(await (await page.request.get("/api/scenes/xian/business")).json()).toEqual(originalBusiness);
});

test("场景包导入校验失败保留当前表单，合法文件仅进入未保存草稿", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入演示系统" }).click();
  await page.locator(".side-navigation").getByRole("button", { name: "系统管理" }).click();
  await page.getByRole("menuitem", { name: "场景包管理", exact: true }).click();
  const manager = page.getByRole("region", { name: "场景包管理", exact: true });
  const name = manager.getByRole("textbox", { name: "场景名称", exact: true });
  await expect(name).toHaveValue("西安市");
  const input = manager.locator('input[type="file"]');
  await input.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"formatVersion":2,"script":"alert(1)"}') });
  await expect(manager.getByRole("alert").filter({ hasText: "导入失败" })).toBeVisible();
  await expect(name).toHaveValue("西安市");
  const record = await (await page.request.get("/api/scenes/xian/scenario-pack")).json();
  record.data.draft.scene.name = "导入场景验收";
  await input.setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record.data.draft)) });
  await expect(name).toHaveValue("导入场景验收");
  await expect(manager.getByText("校验通过，尚未保存和发布")).toBeVisible();
  expect((await (await page.request.get("/api/scenes/xian/scenario-pack")).json()).revision).toBe(0);
  expect((await (await page.request.get("/api/scenes")).json())[0].name).toBe("西安市");
});

test("只有未发布地区的新管理员可从空场景页完成首次配置", async ({ page }) => {
  // 真实HTTP的新增地区/权限/采集由platform-http覆盖；这里单独验证空目录的引导界面。
  const user = { id: "setup-admin", tenantId: "setup-tenant", role: "admin", kind: "account", scenes: ["test-city"] };
  let record: import("@dtv/contracts").ScenarioRevision = { revision: 0, data: { draft: null, published: null, history: [] } };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ json: { user, demoEnabled: false } });
    if (path === "/api/authorization") return route.fulfill({ json: { revision:0,tenantId:user.tenantId,state:"development",modules:["map","stations","weather","roam","devices","files","plugins","ingestion"],datasets:["stations","surface-hourly"],regions:null,maxAccounts:10000 } });
    if (path === "/api/scenes") return route.fulfill({ json: record.data.published ? [record.data.published.scene] : [] });
    if (path.endsWith("/scenario-pack")) {
      if (route.request().method() === "PUT") record = { revision: record.revision + 1, data: { ...record.data, draft: route.request().postDataJSON().pack } };
      return route.fulfill({ json: record });
    }
    if (path.endsWith("/scenario-pack/publish")) {
      record = { revision: record.revision + 1, data: { ...record.data, published: record.data.draft } };
      return route.fulfill({ status: 201, json: record });
    }
    if (path.endsWith("/business")) return route.fulfill({ json: { revision: 0, owner: user, data: { version: 1, stations: [], bookmarks: [], plans: [], assets: [], users: [] } } });
    if (path.endsWith("/ingestion")) return route.fulfill({ json: { mode: "demo", source: "mock", jobs: [], watermark: null } });
    if (path.endsWith("/times")) return route.fulfill({ json: ["2026-11-07T00:00:00+08:00"] });
    if (path === "/api/display-config") return route.fulfill({ json: { tiandituKey: null, cesiumIonAccessToken: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await expect(page.getByText("当前账号暂无已发布场景")).toBeVisible();
  await page.getByRole("button", { name: "新建配置草稿" }).click();
  const longName = "新地区演示" + "气象平台".repeat(12);
  await page.getByRole("textbox", { name: "场景名称", exact: true }).fill(longName);
  await page.getByRole("textbox", { name: "地区简称", exact: true }).fill("新城");
  await page.getByRole("spinbutton", { name: "场景中心经度" }).fill("116.4");
  await page.getByRole("spinbutton", { name: "场景中心纬度" }).fill("39.9");
  await page.getByRole("button", { name: "保存场景草稿" }).click();
  await expect(page.getByText("草稿已保存，在线配置尚未改变")).toBeVisible();
  await page.getByRole("button", { name: "发布已保存草稿" }).click();
  await expect(page.locator("header h1")).toContainText(longName);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "打开账号菜单" }).click();
  await expect(page.getByRole("menuitem", { name: "退出", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
  await expect(page.getByText("当前账号暂无已发布场景")).toHaveCount(0);
  await expect(page.locator(".side-navigation").getByRole("button", { name: "总览地图" })).toBeVisible();
});

test("插件菜单Widget与站点Provider贯通，卸载及地区切换清理全部贡献", async ({ page }) => {
 test.setTimeout(60000);
 await page.goto("/");await page.getByRole("button",{name:"进入演示系统"}).click();
 await expect(page.locator(".time-ticks button")).toHaveCount(13);
 await page.locator(".side-navigation").getByRole("button",{name:"系统管理"}).click();
 await page.getByRole("menuitem",{name:"插件管理",exact:true}).click();
 await page.getByRole("button",{name:"安装选中插件"}).click();
 await expect(page.locator(".side-navigation").getByRole("button",{name:"客户扩展专题"})).toBeVisible();
 await page.locator(".side-navigation").getByRole("button",{name:"客户扩展专题"}).click();
 await expect(page.getByRole("region",{name:"客户扩展专题"})).toContainText("不代表真实实况");
 await page.getByRole("button",{name:"定位当前场景"}).click();
 await page.screenshot({path:"test-results/plugin-route.png"});
 await page.locator(".side-navigation").getByRole("button",{name:"总览地图"}).click();
 await expect(page.getByRole("complementary",{name:"插件Widget"})).toContainText("客户扩展演示");
 await page.getByRole("button",{name:"站点图层",exact:true}).click();
 const read=page.waitForResponse((r)=>r.url().includes("/plugins/data?")&&r.status()===200);
 await page.getByRole("switch",{name:"客户站点观测"}).click();await read;
 await expect(page.locator('[data-layer="example.station-popup.observations"]')).toHaveAttribute("data-status","on");
 await expect(page.getByRole("switch",{name:"客户站点观测"})).toBeChecked();
 await page.evaluate(()=>new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await page.screenshot({path:"test-results/plugin-provider-widget.png",animations:"disabled"});
 await page.locator(".side-navigation").getByRole("button",{name:"系统管理"}).click();
 await page.getByRole("menuitem",{name:"插件管理",exact:true}).click();
 await page.getByRole("button",{name:"卸载选中插件"}).click();
 await expect(page.locator('iframe[title^="已隔离插件"]')).toHaveCount(0);
 await expect(page.locator(".side-navigation").getByRole("button",{name:"客户扩展专题"})).toHaveCount(0);
 await page.getByRole("button",{name:"安装选中插件"}).click();
 await expect(page.locator('iframe[title^="已隔离插件"]')).toHaveCount(1);
 await page.getByRole("combobox",{name:"地区场景"}).click();
 await page.getByText("太原市场景",{exact:true}).last().click();
 await expect(page.locator('iframe[title^="已隔离插件"]')).toHaveCount(0);
 await expect(page.locator(".plugin-widgets .ant-card")).toHaveCount(0);
});

test("租户产品授权界面区分查看与平台导入，导入失败保留输入", async ({ page }) => {
 await page.goto("/");await page.getByRole("button",{name:"进入演示系统"}).click();
 await expect(page.locator(".time-ticks button")).toHaveCount(13);
 await page.locator(".side-navigation").getByRole("button",{name:"系统管理"}).click();
 await page.getByRole("menuitem",{name:"租户产品授权",exact:true}).click();
 await expect(page.getByRole("region",{name:"租户产品授权"})).toContainText("隔离Mock演示授权");
 await expect(page.getByRole("button",{name:"校验并保存许可证"})).toHaveCount(0);
 // 平台管理员界面使用受控API响应；真实签名/角色/租户/重启由HTTP测试覆盖。
 await page.route("**/api/auth/session",async route=>{const response=await route.fetch();const body=await response.json();body.user.platformAdmin=true;return route.fulfill({json:body});});
 await page.route("**/api/admin/tenants",route=>route.fulfill({json:[{tenantId:"customer-a",accountCount:1}]}));
 await page.route("**/api/admin/tenants/customer-a/authorization",route=>route.fulfill({json:{revision:0,tenantId:"customer-a",state:"missing",modules:[],datasets:[],regions:[],maxAccounts:0}}));
 await page.getByRole("menuitem",{name:"插件管理",exact:true}).click();await page.getByRole("menuitem",{name:"租户产品授权",exact:true}).click();
 await page.getByLabel("授权目标租户").click();await page.getByText("customer-a（1个启用账号）",{exact:true}).click();
 await expect(page.getByRole("region",{name:"租户产品授权"})).toContainText("未导入许可证");
 await page.getByRole("textbox",{name:"签名许可证JSON"}).fill("{invalid");
 await page.getByRole("button",{name:"校验并保存许可证"}).click();
 await expect(page.getByText("许可证JSON格式错误",{exact:true})).toBeVisible();
 await expect(page.getByRole("textbox",{name:"签名许可证JSON"})).toHaveValue("{invalid");
 await expect(page.getByRole("button",{name:"校验并保存许可证"})).toBeEnabled();
 await page.getByLabel("授权目标租户").focus();
 await page.getByLabel("授权目标租户").press("Escape");
 await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
 await page.screenshot({path:"test-results/tenant-authorization.png",animations:"disabled"});
});

test("沙箱启动失败回收注册项，在途Provider卸载后不残留请求或iframe",async({page})=>{
 await page.goto("/");
 const result=await page.evaluate(async()=>{
  const path="/src/pluginSandbox.ts";
  const {createPluginSandbox}=await import(path) as typeof import("../apps/web/src/pluginSandbox");
  let disposed=0;
  const manifest={id:"test.lifecycle",version:"1.0.0",coreApi:1,entry:"/extensions/test/index.js",integrity:"sha256-test",keyId:"test",signature:"test"};
  const callbacks={onSlot:()=>{},onSlotRemoved:()=>{},onLayer:()=>{},onMap:()=>{},onEvent:()=>{},onExtension:()=>{},onExtensionRemoved:()=>{},onData:async()=>{throw Error("测试不应读取宿主数据")},onError:()=>{},onDisposed:()=>{disposed++}};
  let failed=false;
  try{await createPluginSandbox(manifest,'export default {manifest:{id:"test.lifecycle",version:"1.0.0",coreApi:1},async activate(ctx){ctx.routes.register({id:"test.lifecycle.page",title:"临时页面"});throw Error("启动失败")}}',{...callbacks,onExtension:()=>{throw Error("注册失败")}}, {id:"xian",center:[108,34]});}catch{failed=true;}
  const handle=await createPluginSandbox(manifest,'export default {manifest:{id:"test.lifecycle",version:"1.0.0",coreApi:1},async activate(ctx){return ctx.stationProviders.register({id:"test.lifecycle.data",name:"慢数据",datasetKey:"surface-hourly",source:"mock",unit:"°C"},query=>new Promise((resolve,reject)=>query.signal.addEventListener("abort",()=>reject(Error("取消")))));}}',callbacks,{id:"xian",center:[108,34]});
  const pending=handle.queryProvider("test.lifecycle.data","2026-11-07T12:00:00+08:00",new AbortController().signal).catch((e:Error)=>e.message);
  await handle.unload();return{failed,message:await pending,disposed,iframes:document.querySelectorAll('iframe[title^="已隔离插件"]').length};
 });
 expect(result.failed).toBe(true);expect(result.message).toContain("卸载");expect(result.disposed).toBe(2);expect(result.iframes).toBe(0);
});
