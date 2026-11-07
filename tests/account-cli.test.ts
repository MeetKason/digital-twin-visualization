import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
it("账号初始化工具只保存哈希且拒绝覆盖已有账号", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-account-"));
  const path = join(dir, "users.json");
  try {
    async function run() {
      const p = spawn(process.execPath, [
        "scripts/create-account.mjs",
        "--id",
        "qa",
        "--tenant",
        "qa-tenant",
        "--role",
        "viewer",
        "--scenes",
        "xian",
        "--output",
        path,
      ]);
      let output = "";
      p.stdout.on("data", (v) => (output += v));
      p.stderr.on("data", (v) => (output += v));
      p.stdin.end("test-password-1234\n");
      const [code] = await once(p, "exit");
      return { code, output };
    }
    const first = await run();
    expect(first.code).toBe(0);
    expect(first.output).not.toContain("test-password-1234");
    expect(first.output).not.toContain("scrypt:");
    const data = JSON.parse(await readFile(path, "utf8"));
    expect(data[0].passwordHash).toMatch(/^scrypt:/);
    expect(data[0].password).toBeUndefined();
    expect((await run()).code).not.toBe(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(data);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
