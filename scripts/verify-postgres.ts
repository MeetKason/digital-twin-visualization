import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import assert from "node:assert/strict";
import { PostgresRepository } from "../apps/core-api/src/platform/repository";
import { AuthService, hashPassword } from "../apps/core-api/src/platform/auth";
const name = `dtv-pg-verify-${randomUUID().slice(0, 8)}`,
  password = randomBytes(24).toString("hex");
let pool: Pool | undefined;
function command(args: string[], env = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", args, { env });
    let output = "";
    p.stdout.on("data", (b) => (output += b));
    p.stderr.on("data", (b) => (output += b));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`docker command failed (${code}): ${output}`)),
    );
  });
}
try {
  await command(
    [
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_USER=dtv",
      "-e",
      "POSTGRES_DB=dtv",
      "-e",
      "POSTGRES_PASSWORD",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ],
    { ...process.env, POSTGRES_PASSWORD: password },
  );
  const port = Number(
    (await command(["port", name, "5432/tcp"])).trim().split(":").pop(),
  );
  pool = new Pool({
    host: "127.0.0.1",
    port,
    database: "dtv",
    user: "dtv",
    password,
  });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      await pool.query("SELECT 1");
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(ready, "PostgreSQL did not become ready");
  await pool.query(
    await readFile("deploy/migrations/002_platform.sql", "utf8"),
  );
  const repo = new PostgresRepository(pool);
  const results = await Promise.allSettled([
    repo.saveBusiness("alpha", "xian", 0, { value: "A" }, "alice"),
    repo.saveBusiness("alpha", "xian", 0, { value: "B" }, "bob"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal((await repo.readBusiness("alpha", "xian"))?.revision, 1);
  assert.equal(await repo.readBusiness("beta", "xian"), null);
  await repo.saveBusiness("alpha", "xian", 1, { value: "updated" }, "alice");
  assert.equal((await repo.readBusiness("alpha", "xian"))?.revision, 2);
  await assert.rejects(
    repo.saveBusiness("alpha", "xian", 1, { value: "stale" }, "bob"),
  );
  assert.equal(
    (await repo.audit("alpha")).filter((e) => e.action === "business.write")
      .length,
    2,
  );
  const accounts = [
    {
      id: "alice",
      tenantId: "alpha",
      role: "admin" as const,
      scenes: ["xian"],
      passwordHash: hashPassword("verification-password"),
    },
  ];
  const auth = new AuthService(repo, accounts, false),
    session = await auth.login("alice", "verification-password", "local");
  const fresh = new AuthService(new PostgresRepository(pool), accounts, false);
  assert.equal((await fresh.resolve(session.token))?.tenantId, "alpha");
  await fresh.logout(session.token);
  assert.equal(await auth.resolve(session.token), null);
  console.log(
    "PostgreSQL 16 verification passed: migration, concurrent CAS, update, tenant isolation, audit, session restore/revocation.",
  );
} finally {
  await pool?.end();
  await command(["rm", "-f", name]);
  console.log("Temporary PostgreSQL verification container removed.");
}
