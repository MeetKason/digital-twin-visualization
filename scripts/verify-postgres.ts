import { TenantLicensing } from "../apps/core-api/src/platform/licensing";
import { LicensePayloadSchema, licenseCanonical } from "../packages/contracts/src/licensing";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import assert from "node:assert/strict";
import { PostgresRepository } from "../apps/core-api/src/platform/repository";
import { AuthService, hashPassword } from "../apps/core-api/src/platform/auth";
import { PostgresIngestionStore } from "../packages/ingestion/src/postgres";
import type { IngestionProduct } from "../packages/ingestion/src/products";
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
  await pool.query(await readFile("deploy/migrations/002_platform.sql", "utf8"));
  // 此处队列指标验收只依赖租户和时次字段；PostGIS 空间类型由隔离 Compose 验收覆盖。
  await pool.query(`CREATE TABLE weather_observation(
    tenant_id text NOT NULL,station_id text NOT NULL,observed_at timestamptz NOT NULL,
    source text NOT NULL,location text NOT NULL,elements jsonb NOT NULL,
    quality jsonb NOT NULL,ingested_at timestamptz NOT NULL,
    PRIMARY KEY(tenant_id,station_id,observed_at,source))`);
  await pool.query(await readFile("deploy/migrations/003_ingestion.sql", "utf8"));
  await pool.query(
    "INSERT INTO scene_business(tenant_id,scene_id,revision,data) VALUES('legacy','xian',1,$1::jsonb)",
    [JSON.stringify({ stations: [{ id: "old-s", name: "历史站", lon: 100, lat: 30 }], assets: [], bookmarks: [], plans: [] })],
  );
  await pool.query(await readFile("deploy/migrations/004_business_entities.sql", "utf8"));
  await pool.query(await readFile("deploy/migrations/005_publication_workflow.sql", "utf8"));
  await pool.query(`INSERT INTO weather_observation(tenant_id,scene_id,station_id,observed_at,source,location,elements,quality,ingested_at)
    VALUES('legacy-product','xian','old-station','2026-11-08T00:00:00Z','mock','POINT(0 0)','{}','{}','2026-11-08T00:01:00Z')`);
  await pool.query(`INSERT INTO ingestion_state(tenant_id,scene_id,state) VALUES('legacy-product','xian',$1::jsonb)`, [JSON.stringify({
    tenantId: "legacy-product", sceneId: "xian", source: "mock", watermark: "2026-11-08T00:00:00.000Z",
    lastSuccessAt: "2026-11-08T00:01:00.000Z", schedule: { enabled: false, lastEnqueuedAt: null },
    jobs: [{ id: "old-job", source: "mock", status: "succeeded" }],
  })]);
  await pool.query(await readFile("deploy/migrations/006_ingestion_products.sql", "utf8"));
  await pool.query(await readFile("deploy/migrations/006_ingestion_products.sql", "utf8"));
  assert.equal((await pool.query("SELECT product_id FROM weather_observation WHERE tenant_id='legacy-product'")).rows[0].product_id, "surface-hourly");
  await pool.query(await readFile("deploy/migrations/007_runtime_configuration.sql", "utf8"));
  await pool.query(await readFile("deploy/migrations/007_runtime_configuration.sql", "utf8"));

  // 验证真实PostgreSQL持久化的离线许可证可被另一个实例读取并立即响应吊销。
  const pair = generateKeyPairSync("ed25519"), roots = { verify: pair.publicKey.export({format:"jwk"}) };
  const payload = LicensePayloadSchema.parse({formatVersion:1,licenseId:"pg-license",tenantId:"license-tenant",customer:"验证客户",project:{id:"pg",name:"验证项目"},plan:"basic",issuedAt:new Date(Date.now()-1000).toISOString(),notBefore:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),modules:["map","stations"],datasets:["stations","surface-hourly"],regions:["xian"],maxAccounts:2});
  const cert = {keyId:"verify",payload,signature:sign(null,Buffer.from(licenseCanonical("verify",payload)),pair.privateKey).toString("base64")};
  const licensing = new TenantLicensing(new PostgresRepository(pool),roots,true);
  await licensing.import("license-tenant",0,cert,"platform-admin");
  const another = new TenantLicensing(new PostgresRepository(pool),roots,true);
  assert.equal((await another.status("license-tenant")).state,"active");
  assert.equal((await another.status("other-tenant")).state,"missing");
  await assert.rejects(another.require("license-tenant","xian","devices"));
  await assert.rejects(licensing.import("license-tenant",1,cert,"platform-admin"));
  await licensing.revoke("license-tenant",1,"platform-admin");
  assert.equal((await another.status("license-tenant")).state,"revoked");
  assert.equal((await new PostgresRepository(pool).audit("license-tenant")).length,3);
  const configRepo = new PostgresRepository(pool);
  await configRepo.saveConfiguration("config-a", "scenario:xian", 0, { draft: "one" }, "admin", "scenario.draft");
  assert.equal((await configRepo.readConfiguration("config-a", "scenario:xian"))?.revision, 1);
  assert.equal(await configRepo.readConfiguration("config-b", "scenario:xian"), null);
  const conflictingConfigs = await Promise.allSettled([
    configRepo.saveConfiguration("config-a", "scenario:xian", 1, { draft: "two" }, "admin", "scenario.draft"),
    configRepo.saveConfiguration("config-a", "scenario:xian", 1, { draft: "three" }, "admin", "scenario.draft"),
  ]);
  assert.equal(conflictingConfigs.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await configRepo.audit("config-a")).length, 2);
  const migratedState = (await pool.query<{ state: { jobs: { productId: string }[]; productSchedules: object; productProgress: object } }>("SELECT state FROM ingestion_state WHERE tenant_id='legacy-product'")).rows[0].state;
  assert.equal(migratedState.jobs[0].productId, "surface-hourly");
  assert.deepEqual(migratedState.productSchedules, {});
  assert.deepEqual(migratedState.productProgress, {});
  await pool.query(
    `INSERT INTO ingestion_state(tenant_id,scene_id,state) VALUES($1,$2,$3::jsonb)`,
    ["metric-tenant", "xian", JSON.stringify({
      tenantId: "metric-tenant", sceneId: "xian", source: "mock",
      schedule: { enabled: true, lastEnqueuedAt: null },
      jobs: [{ source: "mock", status: "queued" }],
    })],
  );
  const metricSnapshot = await new PostgresIngestionStore(pool).metricsSnapshot();
  assert.deepEqual(metricSnapshot.jobs.slice().sort((a, b) => a.status.localeCompare(b.status)), [
    { source: "mock", status: "queued", count: 1 },
    { source: "mock", status: "succeeded", count: 1 },
  ]);
  assert.equal(metricSnapshot.enabledSchedules, 1);
  const productRegistry: IngestionProduct[] = [
    { id: "surface-hourly", label: "地面小时", available: true, dependencies: [] },
    { id: "surface-quality", label: "质量控制", available: true, dependencies: ["surface-hourly"] },
  ];
  const productStore = new PostgresIngestionStore(pool, () => "mock", productRegistry);
  const productTime = "2026-11-08T00:00:00Z";
  const upstream = await productStore.enqueue("product-tenant", "xian", {
    source: "mock", startTime: productTime, endTime: productTime,
  }, "verifier");
  const derived = await productStore.enqueue("product-tenant", "xian", {
    source: "mock", productId: "surface-quality", startTime: productTime, endTime: productTime,
  }, "verifier");
  assert.equal(derived.productId, "surface-quality");
  assert.equal((await productStore.productStatus("product-tenant", "xian", "surface-hourly")).jobs.length, 1);
  assert.equal((await productStore.productStatus("product-tenant", "xian", "surface-quality")).jobs.length, 1);
  assert.notEqual(upstream.id, derived.id);
  assert.equal((await productStore.metricsSnapshot()).enabledSchedules, 1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM scene_station WHERE tenant_id='legacy'")).rows[0].n, 1);
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
  await repo.saveBusiness("alpha", "xian", 2, {
    stations: [{ id: "s1", name: "站点", lon: 108.9, lat: 34.2, elevationM: 400 }],
    assets: [{ id: "file1", name: "历史附件", kind: "document", blobId: "srv_history", fileName: "历史.pdf", size: 32 }], bookmarks: [{ id: "b1", name: "视角", view: { lon: 108.9, lat: 34.2 } }],
    plans: [{ id: "p1", name: "巡航", saved: true, points: [{ id: "p1a", name: "节点", lon: 108.9, lat: 34.2, height: 100 }] }],
  }, "alice");
  assert.equal((await pool.query("SELECT count(*)::int n FROM scene_station WHERE tenant_id='alpha'")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM scene_bookmark WHERE tenant_id='alpha'")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM scene_cruise_point WHERE tenant_id='alpha'")).rows[0].n, 1);
  const publication = await repo.publishBusiness("alpha", "xian", 3, "alice", "验证发布");
  assert.equal(publication.snapshot.stations[0].id, "s1");
  assert.deepEqual(await repo.publicationFileReferences("alpha", "xian"), ["srv_history"]);
  assert.deepEqual(await repo.publicationFileReferences("beta", "xian"), []);
  assert.deepEqual(await repo.publicationFileReferences("alpha", "taiyuan"), []);
  assert.equal(publication.approvalStatus, "pending_approval");
  await assert.rejects(repo.activatePublication("alpha", "xian", 3, "alice"));
  await assert.rejects(repo.reviewPublication("alpha", "xian", 3, "alice", "approve", ""));
  const approved = await repo.reviewPublication("alpha", "xian", 3, "bob", "approve", "复核通过");
  assert.equal(approved.approvalStatus, "approved");
  const active = await repo.activatePublication("alpha", "xian", 3, "alice", 25);
  assert.equal(active.active, true);
  assert.equal(active.trafficPercent, 25);
  assert.equal((await repo.activePublication("alpha", "xian"))?.revision, 3);
  await assert.rejects(repo.publishBusiness("alpha", "xian", 3, "alice", "重复"));
  const rollback = await repo.rollbackBusiness("alpha", "xian", 3, 3, "alice");
  assert.equal(rollback.revision, 4);
  assert.equal((await repo.readBusiness("alpha", "xian"))?.revision, 4);
  assert((await repo.audit("alpha")).some((entry) => entry.action === "business.rollback"));
  assert.equal((await pool.query("SELECT count(*)::int n FROM scene_station WHERE tenant_id='alpha'")).rows[0].n, 1);
  await assert.rejects(repo.rollbackBusiness("alpha", "xian", 3, 3, "alice"));
  await assert.rejects(
    repo.saveBusiness("alpha", "xian", 1, { value: "stale" }, "bob"),
  );
  assert.equal(
    (await repo.audit("alpha")).filter((e) => e.action === "business.write")
      .length,
    3,
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
  // 确认 PostgreSQL 业务集合从关系表读取，而不是仍保留的 JSONB 兼容副本。
  await pool.query(
    "UPDATE scene_business SET data=data || '{\"stations\":[],\"bookmarks\":[],\"plans\":[]}'::jsonb WHERE tenant_id='alpha' AND scene_id='xian'",
  );
  const projected = await repo.readBusiness("alpha", "xian");
  assert.equal((projected?.data as { stations: unknown[] }).stations.length, 1);
  assert.equal((projected?.data as { bookmarks: unknown[] }).bookmarks.length, 1);
  assert.equal((projected?.data as { plans: { points: unknown[] }[] }).plans[0].points.length, 1);
  console.log(
    "PostgreSQL 16 verification passed: migration, concurrent CAS, normalized entity reads/writes, two-person publication approval/activation/rollback, tenant isolation, signed tenant license import/revocation across instances, audit, session restore/revocation.",
  );
} finally {
  await pool?.end();
  await command(["rm", "-f", name]);
  console.log("Temporary PostgreSQL verification container removed.");
}
