import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRepository } from "../apps/core-api/src/platform/repository";
import { AuthService, hashPassword } from "../apps/core-api/src/platform/auth";
it("身份与持久化：会话恢复、租户隔离、只读拒写、修订冲突和审计", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-platform-"));
  try {
    const repo = new FileRepository(dir);
    const auth = new AuthService(
      repo,
      [
        {
          id: "a",
          tenantId: "alpha",
          role: "admin",
          scenes: ["xian"],
          passwordHash: hashPassword("test-password-a"),
        },
        {
          id: "b",
          tenantId: "beta",
          role: "viewer",
          scenes: ["taiyuan"],
          passwordHash: hashPassword("test-password-b"),
        },
      ],
      true,
    );
    const a = await auth.login("a", "test-password-a", "local"),
      b = await auth.login("b", "test-password-b", "local");
    expect(await auth.resolve(a.token)).toMatchObject({ tenantId: "alpha" });
    await expect(auth.login("a", "wrong", "local")).rejects.toThrow();
    await auth.authorize(a.user, "xian", true);
    await expect(auth.authorize(b.user, "taiyuan", true)).rejects.toThrow();
    await expect(auth.authorize(a.user, "taiyuan", false)).rejects.toThrow();
    const results = await Promise.allSettled([
      repo.saveBusiness("alpha", "xian", 0, { value: "alpha" }, "a"),
      repo.saveBusiness("alpha", "xian", 0, { value: "other" }, "a"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await repo.readBusiness("beta", "xian")).toBeNull();
    const restarted = new FileRepository(dir);
    expect((await restarted.readBusiness("alpha", "xian"))?.revision).toBe(1);
    expect((await restarted.audit("alpha")).length).toBe(4);
    await auth.logout(a.token);
    expect(await auth.resolve(a.token)).toBeNull();
    expect(
      (await restarted.audit("alpha")).some((e) => e.action === "auth.logout"),
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("同一代理地址下一个账号的错误不能锁住其他账号", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-rate-"));
  try {
    const auth = new AuthService(
      new FileRepository(dir),
      [
        {
          id: "first",
          tenantId: "t",
          role: "admin",
          scenes: ["xian"],
          passwordHash: hashPassword("first-password"),
        },
        {
          id: "second",
          tenantId: "t",
          role: "viewer",
          scenes: ["xian"],
          passwordHash: hashPassword("second-password"),
        },
      ],
      false,
    );
    for (let i = 0; i < 5; i++)
      await expect(auth.login("first", "wrong", "same-proxy")).rejects.toThrow(
        "账号或密码错误",
      );
    await expect(
      auth.login("first", "first-password", "same-proxy"),
    ).rejects.toThrow("登录尝试过多");
    expect(
      (await auth.login("second", "second-password", "same-proxy")).user.id,
    ).toBe("second");
    expect(
      (await auth.login("first", "first-password", "another-client")).user.id,
    ).toBe("first");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
