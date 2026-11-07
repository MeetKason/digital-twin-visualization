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
  await page.reload();
  await page.getByRole("button", { name: "进入演示系统" }).click();
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

test("本地模型上传、实际预览、引用保护与场景隔离", async ({ page }) => {
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
  await modal
    .getByLabel("模型文件（GLB / GLTF）")
    .setInputFiles({
      name: "triangle.gltf",
      mimeType: "model/gltf+json",
      buffer: Buffer.from(JSON.stringify(gltf)),
    });
  await modal.getByRole("button", { name: "登记模型", exact: true }).click();
  await expect(modal.getByText("验收模型", { exact: true })).toBeVisible();
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
