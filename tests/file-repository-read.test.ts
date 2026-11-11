import { expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileRepository } from "../apps/core-api/src/platform/repository";

test("会话与配置不遍历无关业务包，单个资料包损坏不会清空整个仓库", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-lazy-business-"));
  try {
    const repo = new FileRepository(root);
    await repo.saveBusiness("good", "xian", 0, { value: "good" }, "admin");
    await repo.saveBusiness("old", "xian", 0, { value: "old" }, "admin");
    const user = {
      id: "admin",
      tenantId: "good",
      role: "admin" as const,
      scenes: ["xian"],
      kind: "account" as const,
    };
    await repo.putSession("test-session", {
      user,
      expiresAt: Date.now() + 3600000,
    });
    const state = JSON.parse(
      await readFile(join(root, "platform.json"), "utf8"),
    );
    const key = JSON.stringify(["old", "xian"]);
    await rm(
      join(
        root,
        "business-bundles",
        createHash("sha256").update(key).digest("hex"),
        state.business[key].bundleId,
      ),
      { recursive: true, force: true },
    );
    expect(await repo.getSession("test-session")).toMatchObject({ user });
    expect(await repo.readBusiness("good", "xian")).toMatchObject({
      data: { value: "good" },
    });
    await repo.saveConfiguration(
      "good",
      "scenario:xian",
      0,
      { value: "safe" },
      "admin",
      "scenario.draft",
    );
    expect(await repo.readConfiguration("good", "scenario:xian")).toMatchObject(
      { revision: 1 },
    );
    await expect(repo.readBusiness("old", "xian")).rejects.toThrow("业务资料");
    const retained = JSON.parse(
      await readFile(join(root, "platform.json"), "utf8"),
    );
    expect(Object.keys(retained.business)).toHaveLength(2);
    expect(retained.sessions["test-session"].user.id).toBe("admin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
