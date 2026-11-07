import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
const port = process.env.SMOKE_PORT ?? "3002",
  dir = await mkdtemp(join(tmpdir(), "dtv-built-"));
const child = spawn(process.execPath, ["dist/server/core-api/src/main.js"], {
  env: {
    ...process.env,
    PORT: port,
    DATA_DIR: dir,
    DATABASE_URL: "",
    PGHOST: "",
    AUTH_USERS_FILE: "",
    DEMO_ENABLED: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (b) => (logs += b));
child.stderr.on("data", (b) => (logs += b));
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, logs);
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/demo`, {
    method: "POST",
    headers: { "X-DTV-Request": "1" },
  });
  assert.equal(login.status, 201);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const scenes = await (
    await fetch(`http://127.0.0.1:${port}/api/scenes`, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(scenes.length, 3);
  const response = await fetch(
    `http://127.0.0.1:${port}/api/search?sceneId=xian&q=108.94,34.34`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).coordinate, [108.94, 34.34]);
  console.log(
    "Built API smoke passed: server session, 3 authorized scenes, coordinate route.",
  );
} finally {
  if (child.exitCode === null) {
    const ended = once(child, "exit");
    child.kill("SIGTERM");
    await ended;
  }
  await rm(dir, { recursive: true, force: true });
}
