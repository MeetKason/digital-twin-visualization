import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Platform } from "../apps/core-api/src/platform/platform";
import { FileRepository, type Principal } from "../apps/core-api/src/platform/repository";
import fixtures from "../apps/core-api/src/demo-assets/fixtures.generated.json";
import { validateUpload } from "@dtv/contracts";

test("演示媒体内容有效，初始化幂等且不覆盖修订，文件按租户和地区隔离", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-demo-media-"));
  const platform = new Platform(new FileRepository(root), [], true, join(root, "files"));
  const user: Principal = { id: "demo-a", tenantId: "demo-a", role: "admin", scenes: ["xian"], kind: "demo" };
  try {
    for (const fixture of fixtures) await expect(validateUpload(new File([Buffer.from(fixture.base64, "base64")], fixture.name))).resolves.toBeTruthy();
    const [one, two] = await Promise.all([platform.initializeDemoScene(user, "xian"), platform.initializeDemoScene(user, "xian")]);
    expect(one.revision).toBe(1);
    expect(two.revision).toBe(1);
    expect(one.data.assets).toHaveLength(3);
    expect(one.data.stations[0].modelId).toBe(one.data.assets[0].id);
    expect(one.data.plans[0].points[0].modelId).toBe(one.data.assets[0].id);
    const files = await platform.files.list(user.tenantId, "xian");
    expect(files).toHaveLength(3);
    await expect(platform.files.metadata("another", "xian", files[0].id)).rejects.toThrow();
    await expect(platform.files.metadata(user.tenantId, "taiyuan", files[0].id)).rejects.toThrow();
    one.data.stations[0].name = "已编辑资料";
    await platform.save(user, "xian", one);
    expect((await platform.initializeDemoScene(user, "xian")).data.stations[0].name).toBe("已编辑资料");
    await expect(platform.initializeDemoScene({ ...user, kind: "account" }, "xian")).rejects.toThrow("演示");
  } finally { await platform.close(); await rm(root, { recursive: true, force: true }); }
});
