import { Pool } from "pg";
import { IngestRunner, MockConnector, MemoryStore } from "./index";
import { PostgresStore } from "./postgres";
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const runner = new IngestRunner(
  new MockConnector(),
  pool ? new PostgresStore(pool) : new MemoryStore(),
);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
let failures = 0;
while (!stopping) {
  const time = new Date(
    Math.floor(Date.now() / 3600000) * 3600000,
  ).toISOString();
  try {
    const count = await runner.run(time);
    failures = 0;
    console.log(
      JSON.stringify({
        source: "mock",
        status: "ok",
        time,
        count,
        storage: pool ? "postgres" : "memory",
      }),
    );
  } catch (error) {
    failures++;
    console.error(
      JSON.stringify({
        status: "error",
        attempt: failures,
        message: error instanceof Error ? error.message : "采集失败",
      }),
    );
  }
  if (process.env.WORKER_ONCE === "1") break;
  const delay = Math.min(60000, 3000 * 2 ** Math.min(failures, 4));
  for (let elapsed = 0; elapsed < delay && !stopping; elapsed += 250)
    await new Promise((r) => setTimeout(r, 250));
}
await pool?.end();
