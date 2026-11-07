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
