import { expect, test } from "vitest";
import { LAYERS, ScenarioPackSchema } from "@dtv/contracts";
import xian from "../scenarios/xian.json";
const valid = () => ({
  formatVersion: 1,
  coreApi: 1,
  scene: {
    ...xian,
    enabledLayers: LAYERS.map((layer) => layer.id),
    ui: {
      menus: ["home", "settings"],
      theme: { primary: "#157755", navy: "#123456" },
      layout: { panelWidth: 280, timelineHeight: 120 },
    },
  },
});
test("接受声明式场景包，拒绝版本、脚本、任意URL、重复菜单和缺失依赖", () => {
  expect(ScenarioPackSchema.safeParse(valid()).success).toBe(true);
  expect(ScenarioPackSchema.safeParse({ ...valid(), coreApi: 2 }).success).toBe(
    false,
  );
  expect(
    ScenarioPackSchema.safeParse({ ...valid(), script: "alert(1)" }).success,
  ).toBe(false);
  const light = valid();
  light.scene.ui.theme.navy = "#ffffff";
  expect(ScenarioPackSchema.safeParse(light).success).toBe(false);
  const pack = valid();
  expect(
    ScenarioPackSchema.safeParse({
      ...pack,
      scene: { ...pack.scene, boundaryUrl: "https://evil.invalid/a.geojson" },
    }).success,
  ).toBe(false);
  pack.scene.ui.menus.push("home");
  expect(ScenarioPackSchema.safeParse(pack).success).toBe(false);
  const missing = valid();
  missing.scene.enabledLayers = ["radar"];
  expect(ScenarioPackSchema.safeParse(missing).success).toBe(false);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRepository } from "../apps/core-api/src/platform/repository";
test("配置仓库持久化、CAS冲突和租户隔离，并原子记录审计", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-config-"));
  try {
    const repo = new FileRepository(root);
    const results = await Promise.allSettled([
      repo.saveConfiguration(
        "a",
        "scenario:xian",
        0,
        valid(),
        "admin",
        "scenario.draft",
      ),
      repo.saveConfiguration(
        "a",
        "scenario:xian",
        0,
        valid(),
        "admin",
        "scenario.draft",
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await new FileRepository(root).readConfiguration("a", "scenario:xian"),
    ).toMatchObject({ revision: 1 });
    expect(await repo.readConfiguration("b", "scenario:xian")).toBeNull();
    expect(await repo.audit("a")).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { ScenarioCatalog } from "../apps/core-api/src/platform/scenarios";
import type { Principal } from "../apps/core-api/src/platform/repository";
test("草稿不生效，发布按租户隔离，恢复历史仅创建草稿，新地区需发布且独立授权", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-scenario-"));
  try {
    const repo = new FileRepository(root);
    const catalog = new ScenarioCatalog(repo);
    const admin: Principal = {
      id: "admin",
      tenantId: "a",
      role: "admin",
      kind: "account",
      scenes: ["xian", "custom-city"],
    };
    const pack = valid();
    pack.scene.name = "自定义西安";
    const draft = await catalog.saveDraft(admin, "xian", 0, pack);
    expect((await catalog.active("a", "xian")).name).toBe("西安市");
    await catalog.publish(admin, "xian", draft.revision);
    expect((await catalog.active("a", "xian")).name).toBe("自定义西安");
    expect((await catalog.active("b", "xian")).name).toBe("西安市");
    pack.scene.name = "第二版";
    await catalog.saveDraft(admin, "xian", 2, pack);
    await catalog.publish(admin, "xian", 3);
    await catalog.restore(admin, "xian", 4, 2);
    expect((await catalog.active("a", "xian")).name).toBe("第二版");
    expect((await catalog.read(admin, "xian")).data.draft?.scene.name).toBe(
      "自定义西安",
    );
    await expect(catalog.publish(admin, "xian", 4)).rejects.toThrow("冲突");
    await expect(
      catalog.read({ ...admin, role: "viewer" }, "xian"),
    ).rejects.toThrow("管理员");
    await expect(
      catalog.saveDraft(admin, "taiyuan", 0, valid()),
    ).rejects.toThrow("授权");
    const custom = valid();
    custom.scene.id = "custom-city";
    await catalog.saveDraft(admin, "custom-city", 0, custom);
    expect((await catalog.list(admin)).map((scene) => scene.id)).not.toContain(
      "custom-city",
    );
    await catalog.publish(admin, "custom-city", 1);
    expect((await catalog.list(admin)).map((scene) => scene.id)).toContain(
      "custom-city",
    );
    expect(
      (
        await new ScenarioCatalog(new FileRepository(root)).active(
          "a",
          "custom-city",
        )
      ).name,
    ).toBe(custom.scene.name);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { MockSceneConnector } from "../packages/ingestion/src/worker";
test("动态地区Mock采集根据任务租户读取发布中心，不能混用其他租户场景", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-dynamic-scene-"));
  try {
    const catalog = new ScenarioCatalog(new FileRepository(root));
    const user: Principal = {
      id: "admin",
      tenantId: "a",
      role: "admin",
      kind: "account",
      scenes: ["custom-city"],
    };
    const pack = valid();
    pack.scene.id = "custom-city";
    pack.scene.center = [116.4, 39.9];
    await catalog.saveDraft(user, "custom-city", 0, pack);
    await catalog.publish(user, "custom-city", 1);
    const connector = new MockSceneConnector((id, tenant) =>
      catalog.active(tenant, id),
    );
    const rows = await connector.fetch(
      "custom-city",
      "2026-11-07T00:00:00Z",
      undefined,
      "mock",
      "surface-hourly",
      "a",
    );
    expect(rows[1].location).toMatchObject({ lon: 116.4, lat: 39.9 });
    await expect(
      connector.fetch(
        "custom-city",
        "2026-11-07T00:00:00Z",
        undefined,
        "mock",
        "surface-hourly",
        "b",
      ),
    ).rejects.toThrow("不存在");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("保留最近20个发布快照，拒绝已淘汰版本及损坏的跨地区配置", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-scenario-history-"));
  try {
    const repo = new FileRepository(root);
    const catalog = new ScenarioCatalog(repo);
    const admin: Principal = {
      id: "admin",
      tenantId: "a",
      role: "admin",
      kind: "account",
      scenes: ["xian"],
    };
    for (let i = 0; i < 21; i++) {
      const pack = valid();
      pack.scene.revision = `v${i}`;
      await catalog.saveDraft(admin, "xian", i * 2, pack);
      await catalog.publish(admin, "xian", i * 2 + 1);
    }
    const record = await catalog.read(admin, "xian");
    expect(record.data.history).toHaveLength(20);
    expect(record.data.history[0].revision).toBe(4);
    await expect(catalog.restore(admin, "xian", 42, 2)).rejects.toThrow("历史");
    const corrupted = valid();
    corrupted.scene.id = "taiyuan";
    await repo.saveConfiguration(
      "broken",
      "scenario:xian",
      0,
      { draft: corrupted, published: null, history: [] },
      "admin",
      "scenario.draft",
    );
    await expect(catalog.active("broken", "xian")).rejects.toThrow("配置无效");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
