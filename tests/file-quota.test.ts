import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../apps/core-api/src/platform/files";
import fixtures from "../apps/core-api/src/demo-assets/fixtures.generated.json";

test("文件配额按租户和场景隔离，删除后可以释放容量", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-file-quota-"));
  const store = new FileStore(root, 2_000);
  const fixture = fixtures.find((item) => item.name.endsWith(".gltf"))!;
  const file = new File([Buffer.from(fixture.base64, "base64")], fixture.name);
  try {
    const first = await store.storeDemoFile("tenant-a", "xian", file);
    await expect(store.storeDemoFile("tenant-a", "xian", file)).rejects.toThrow("文件容量配额不足");
    await expect(store.list("tenant-a", "xian")).resolves.toHaveLength(1);
    await expect(store.storeDemoFile("tenant-b", "xian", file)).resolves.toBeTruthy();
    await expect(store.storeDemoFile("tenant-a", "taiyuan", file)).resolves.toBeTruthy();
    await store.remove("tenant-a", "xian", first.id);
    await expect(store.storeDemoFile("tenant-a", "xian", file)).resolves.toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
