import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { Platform } from "../apps/core-api/src/platform/platform";
import {
  FileRepository,
  type Principal,
} from "../apps/core-api/src/platform/repository";
import { hashPassword } from "../apps/core-api/src/platform/auth";
import { TenantLicensing } from "../apps/core-api/src/platform/licensing";
import {
  ConfiguredSceneConnector,
  QueueWorker,
} from "../packages/ingestion/src/worker";
import { licenseIssuer } from "./helpers/licenses";
const admin: Principal = {
  id: "tenant-admin",
  tenantId: "alpha",
  role: "admin",
  scenes: ["xian"],
  kind: "account",
};
test("平台管理员与局方管理员区分：跨租户、账号上限、地区、保留平台ID不可绕过", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-grant-")),
    issuer = licenseIssuer();
  const saved = {
    admins: process.env.PLATFORM_ADMIN_IDS,
    roots: process.env.LICENSE_TRUST_ROOTS_FILE,
    required: process.env.LICENSE_REQUIRED,
  };
  let p: Platform | undefined;
  try {
    const roots = join(root, "roots.json"),
      users = join(root, "users.json");
    await writeFile(roots, JSON.stringify(issuer.roots));
    process.env.PLATFORM_ADMIN_IDS = "operator,reserved";
    process.env.LICENSE_TRUST_ROOTS_FILE = roots;
    process.env.LICENSE_REQUIRED = "true";
    const accounts = [
      {
        id: admin.id,
        tenantId: "alpha",
        role: "admin" as const,
        scenes: ["xian"],
        passwordHash: hashPassword("test-password"),
      },
      {
        id: "operator",
        tenantId: "operations",
        role: "admin" as const,
        scenes: ["xian"],
        passwordHash: hashPassword("test-password"),
      },
    ];
    await writeFile(users, JSON.stringify(accounts));
    p = new Platform(
      new FileRepository(root),
      accounts,
      false,
      join(root, "files"),
      users,
    );
    await p.licensing.import(
      "alpha",
      0,
      issuer.issue({
        plan: "basic",
        modules: ["map", "stations"],
        datasets: ["stations", "surface-hourly"],
        regions: ["xian"],
        maxAccounts: 2,
      }),
      "operator",
    );
    expect(p.listAccounts(admin).map((a) => a.id)).toEqual([admin.id]);
    expect(() => p!.tenantDirectory(admin)).toThrow();
    const input = {
      id: "new-reader",
      tenantId: "alpha",
      role: "viewer",
      scenes: ["xian"],
      password: "test-password",
    };
    await expect(
      p.createAccount(admin, { ...input, tenantId: "beta" }),
    ).rejects.toThrow();
    await expect(
      p.createAccount(admin, { ...input, scenes: ["taiyuan"] }),
    ).rejects.toThrow();
    await expect(
      p.createAccount(admin, { ...input, id: "reserved" }),
    ).rejects.toThrow();
    await p.createAccount(admin, input);
    await expect(
      p.createAccount(admin, { ...input, id: "overflow" }),
    ).rejects.toThrow("上限");
    await expect(
      p.resetAccountPassword(admin, "operator", {
        password: "changed-password",
      }),
    ).rejects.toThrow();
    await expect(p.module(admin, "xian", "plugins")).rejects.toThrow();
    await expect(p.layer(admin, "xian", "radar")).rejects.toThrow();
    expect((await p.scenesFor(admin))[0].ui?.menus).toEqual([
      "home",
      "station",
      "settings",
    ]);
    await p.licensing.revoke("alpha", 1, "operator");
    expect(await p.scenesFor(admin)).toEqual([]);
  } finally {
    await p?.close();
    for (const [key, value] of Object.entries({
      PLATFORM_ADMIN_IDS: saved.admins,
      LICENSE_TRUST_ROOTS_FILE: saved.roots,
      LICENSE_REQUIRED: saved.required,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
test("授权关闭隐藏集合且普通保存保留原文，伪造修改拒绝；Worker拒绝吊销后的排队任务", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-protect-")),
    issuer = licenseIssuer(),
    roots = join(root, "roots.json");
  const original = {
    roots: process.env.LICENSE_TRUST_ROOTS_FILE,
    required: process.env.LICENSE_REQUIRED,
  };
  let p: Platform | undefined;
  try {
    await writeFile(roots, JSON.stringify(issuer.roots));
    process.env.LICENSE_TRUST_ROOTS_FILE = roots;
    process.env.LICENSE_REQUIRED = "true";
    const repo = new FileRepository(root);
    p = new Platform(repo, [], false, join(root, "files"));
    const initial = await p.business(admin, "xian");
    initial.data.bookmarks = [
      {
        id: "view-a",
        name: "保留视角",
        view: {
          lon: 108,
          lat: 34,
          height: 1000,
          heading: 0,
          pitch: -1,
          roll: 0,
        },
      },
    ];
    initial.data.stations[0].bookmarkId = "view-a";
    await repo.saveBusiness("alpha", "xian", 0, initial.data, admin.id);
    // 历史快照中的隐藏视角与当前草稿不同，降级后不能用回滚接口间接修改。
    const historical = structuredClone(initial.data);
    historical.bookmarks[0].name = "历史视角";
    await repo.saveBusiness("alpha", "xian", 1, historical, admin.id);
    await repo.publishBusiness("alpha", "xian", 2, admin.id, "测试历史");
    await repo.saveBusiness("alpha", "xian", 2, initial.data, admin.id);
    await p.licensing.import(
      "alpha",
      0,
      issuer.issue({
        plan: "basic",
        modules: ["map", "stations"],
        datasets: ["stations", "surface-hourly"],
        regions: ["xian"],
      }),
      "operator",
    );
    const visible = await p.business(admin, "xian");
    expect(visible.data.bookmarks).toEqual([]);
    expect(visible.data.stations[0].bookmarkId).toBeUndefined();
    visible.data.stations[0].name = "更新站点";
    await p.save(admin, "xian", visible);
    const persisted = await repo.readBusiness("alpha", "xian");
    expect((persisted!.data as typeof initial.data).bookmarks[0].name).toBe(
      "保留视角",
    );
    expect(
      (persisted!.data as typeof initial.data).stations[0].bookmarkId,
    ).toBe("view-a");
    await expect(
      p.rollbackBusiness(admin, "xian", 2, persisted!.revision),
    ).rejects.toThrow("授权");
    const attack = await p.business(admin, "xian");
    attack.data.bookmarks = initial.data.bookmarks;
    await expect(p.save(admin, "xian", attack)).rejects.toThrow("未授权");
    const licensing = new TenantLicensing(repo, issuer.roots, true);
    await licensing.import("alpha", 1, issuer.issue(), "operator");
    const connector = new ConfiguredSceneConnector(
      undefined,
      (id, tenant) => p!.scenarios.active(tenant, id),
      async (tenant, id, product) => {
        await licensing.require(tenant, id, "ingestion", product);
      },
    );
    await p.ingestion.enqueue(
      "alpha",
      "xian",
      {
        source: "mock",
        productId: "surface-hourly",
        startTime: "2026-11-07T12:00:00+08:00",
        endTime: "2026-11-07T12:00:00+08:00",
      },
      "operator",
    );
    await licensing.revoke("alpha", 2, "operator");
    await new QueueWorker(p.ingestion, connector).tick();
    expect(await p.ingestion.times("alpha", "xian")).toEqual([]);
  } finally {
    await p?.close();
    if (original.roots === undefined)
      delete process.env.LICENSE_TRUST_ROOTS_FILE;
    else process.env.LICENSE_TRUST_ROOTS_FILE = original.roots;
    if (original.required === undefined) delete process.env.LICENSE_REQUIRED;
    else process.env.LICENSE_REQUIRED = original.required;
    await rm(root, { recursive: true, force: true });
  }
});
