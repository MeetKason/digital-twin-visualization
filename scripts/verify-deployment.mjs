// Local integration verification only. Uses isolated containers, ports and volumes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const temp = await mkdtemp(join(tmpdir(), "dtv-deployment-"));
const project = `dtv-files-verify-${randomBytes(4).toString("hex")}`;
const listener = createServer().listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  DEMO_ENABLED: "true",
  AUTH_USERS_FILE: "",
  COOKIE_SECURE: "false",
  COMPOSE_PROJECT_NAME: project,
};
// Stage only deployment configuration: macOS protected Documents mounts can stall Docker.
const stagedDeploy = join(temp, "deploy");
await mkdir(join(stagedDeploy, "auth"), { recursive: true });
for (const entry of ["compose.yaml", "config.json", "migrations"]) {
  await cp(resolve("deploy", entry), join(stagedDeploy, entry), {
    recursive: true,
  });
}
const override = join(temp, "override.yaml");
await writeFile(
  override,
  `services:
  web:
    ports: !override ["127.0.0.1:${port}:80"]
    volumes: !reset []
  core-api:
    volumes: !override ["platform-files:/app/.data/files"]
  postgres:
    platform: linux/amd64
    volumes: !override ["postgres-data:/var/lib/postgresql/data", "verify-migrations:/docker-entrypoint-initdb.d"]
volumes:
  verify-migrations:
`,
);
const composeArgs = [
  "compose",
  "-f",
  join(stagedDeploy, "compose.yaml"),
  "-f",
  override,
];
// Exported to the existing backup/restore shell scripts as well.
env.COMPOSE_FILE = `${join(stagedDeploy, "compose.yaml")}:${override}`;
async function compose(...args) {
  const result = await exec("docker", [...composeArgs, ...args], {
    env,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 240000,
  });
  return result.stdout;
}
const base = `http://127.0.0.1:${port}/api`;
let cookie = "";
async function call(path, method = "GET", body, extra = {}) {
  return fetch(base + path, {
    method,
    headers: {
      Cookie: cookie,
      "X-DTV-Request": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
try {
  console.log(
    "Starting isolated Compose deployment (PostGIS amd64 emulation on ARM hosts)…",
  );
  // Seed the exact configuration bytes without host bind mounts (Docker Desktop sharing may be unavailable).
  await compose("create", "--no-build");
  const postgresId = (await compose("ps", "-aq", "postgres")).trim();
  const webId = (await compose("ps", "-aq", "web")).trim();
  await exec(
    "docker",
    [
      "cp",
      `${join(stagedDeploy, "migrations")}/.`,
      `${postgresId}:/docker-entrypoint-initdb.d/`,
    ],
    { env },
  );
  await exec(
    "docker",
    [
      "cp",
      join(stagedDeploy, "config.json"),
      `${webId}:/usr/share/nginx/html/config.json`,
    ],
    { env },
  );
  await compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "120");
  const health = await (await call("/health")).json();
  assert.equal(health.storage, "postgresql");
  const login = await call("/auth/demo", "POST");
  assert.equal(login.status, 201);
  cookie = login.headers.get("set-cookie").split(";")[0];
  // Two independent Workers compete for the same persistent queue.
  await compose("up", "-d", "--no-build", "--scale", "worker=2", "worker");
  const ingestionPath = "/scenes/xian/ingestion";
  const requested = await call(ingestionPath + "/jobs", "POST", {
    source: "mock",
    startTime: "2026-11-07T00:00:00Z",
    endTime: "2026-11-07T02:00:00Z",
  });
  assert.equal(requested.status, 201);
  const task = await requested.json();
  let ingestion;
  for (let i = 0; i < 100; i++) {
    ingestion = await (await call(ingestionPath)).json();
    if (ingestion.jobs.find((j) => j.id === task.id)?.status === "succeeded")
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(ingestion.jobs[0].status, "succeeded");
  assert.equal(ingestion.jobs[0].completedHours, 3);
  assert.equal(ingestion.jobs[0].rowCount, 18);
  assert.equal(
    (await call(ingestionPath + "/config", "PUT", { mode: "ingested" })).status,
    200,
  );
  const dataPath =
    "/layers/temperature/data?sceneId=xian&time=2026-11-07T02:00:00.000Z";
  const observations = await (await call(dataPath)).json();
  assert.equal(observations.storage, "ingested");
  assert.equal(observations.source, "mock");
  assert.equal(observations.observations.length, 6);
  assert.equal((await call(dataPath.replace("02:00", "03:00"))).status, 404);
  const otherLogin = await fetch(base + "/auth/demo", {
    method: "POST",
    headers: { "X-DTV-Request": "1" },
  });
  const otherCookie = otherLogin.headers.get("set-cookie").split(";")[0];
  const otherStatus = await (
    await fetch(base + ingestionPath, { headers: { Cookie: otherCookie } })
  ).json();
  assert.deepEqual(otherStatus.jobs, []);
  const otherRows = await (
    await fetch(
      base + ingestionPath + "/observations?time=2026-11-07T02:00:00.000Z",
      { headers: { Cookie: otherCookie } },
    )
  ).json();
  assert.deepEqual(otherRows.observations, []);
  const pdf =
    "%PDF-1.7 Compose persistent file\n" + "x".repeat(2 * 1024 * 1024);
  const uploaded = await fetch(base + "/scenes/xian/files", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-DTV-Request": "1",
      "Content-Type": "application/octet-stream",
      "X-File-Name": "compose.pdf",
    },
    body: pdf,
  });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const file = await uploaded.json();
  const state = await (await call("/scenes/xian/business")).json();
  state.data.assets.push({
    id: "compose-pdf",
    name: "Compose PDF",
    kind: "document",
    blobId: file.id,
    fileName: file.name,
    size: file.size,
  });
  assert.equal((await call("/scenes/xian/business", "PUT", state)).status, 200);
  const backup = join(temp, "backup");
  await exec("bash", ["scripts/backup.sh", backup], {
    env,
    maxBuffer: 2 * 1024 * 1024,
  });
  // Mutate both stores after snapshot, then restore the exact DB/file pair.
  await compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "60");
  const remove = await (await call("/scenes/xian/business")).json();
  remove.data.assets = [];
  assert.equal(
    (await call("/scenes/xian/business", "PUT", remove)).status,
    200,
  );
  assert.equal(
    (await call(`/scenes/xian/files/${file.id}`, "DELETE")).status,
    200,
  );
  assert.equal((await call(`/scenes/xian/files/${file.id}`)).status, 404);
  await exec("bash", ["scripts/restore.sh", backup], {
    env: { ...env, CONFIRM_RESTORE: "yes" },
    maxBuffer: 2 * 1024 * 1024,
  });
  await compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "60");
  const restored = await (await call("/scenes/xian/business")).json();
  assert.equal(restored.data.assets[0].blobId, file.id);
  assert.equal(await (await call(`/scenes/xian/files/${file.id}`)).text(), pdf);
  assert.deepEqual(await (await call(dataPath)).json(), observations);
  assert.equal(
    (await (await call(ingestionPath)).json()).jobs[0].completedHours,
    3,
  );
  const worker = await compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "dtv",
    "-d",
    "dtv",
    "-Atc",
    "SELECT count(*) FROM weather_observation",
  );
  assert(
    Number(worker.trim()) > 0,
    "Worker must insert mock observations into PostGIS",
  );
  console.log(
    "PASS: Nginx >1MB upload, server auth, PostGIS/Worker, persistent file volume, two-Worker queue/ingested API/tenant isolation, consistent backup/mutate/restore",
  );
} catch (error) {
  console.error(
    "Deployment verification failed:",
    (error.stderr ?? error.message).slice(-4000),
  );
  process.exitCode = 1;
} finally {
  await compose("down", "-v", "--remove-orphans");
  await rm(temp, { recursive: true, force: true });
  console.log("Isolated verification containers and volumes removed.");
}
