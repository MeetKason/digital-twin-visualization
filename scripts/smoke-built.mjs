import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const port = process.env.SMOKE_PORT ?? "3002";
const child = spawn(process.execPath, ["dist/server/core-api/src/main.js"], {
  env: { ...process.env, PORT: port },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (b) => (logs += b));
child.stderr.on("data", (b) => (logs += b));
try {
  let response;
  for (let i = 0; i < 50; i++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/scenes`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert(response?.ok, logs);
  const scenes = await response.json();
  assert.equal(scenes.length, 3);
  const result = await fetch(
    `http://127.0.0.1:${port}/api/search?sceneId=xian&q=108.94,34.34`,
  );
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).coordinate, [108.94, 34.34]);
  console.log(
    "Built NestJS API smoke passed: 3 scenes, route params, coordinate search.",
  );
} finally {
  child.kill("SIGTERM");
}
