import { Pool } from "pg";
import { PostgresIngestionStore } from "../../../packages/ingestion/src/postgres";
import { QueueWorker } from "../../../packages/ingestion/src/worker";
if (!process.env.DATABASE_URL && !process.env.PGHOST)
  throw new Error(
    "独立 Worker 需要 PostgreSQL；本地开发文件模式由 API 内执行器处理",
  );
const pool = new Pool({
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {}),
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
});
const worker = new QueueWorker(new PostgresIngestionStore(pool));
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
try {
  while (!stopping) {
    let worked = false;
    try {
      worked = await worker.tick();
    } catch {
      console.error(
        JSON.stringify({
          source: "mock",
          status: "error",
          message: "队列读取失败，请检查迁移、数据库与连接配置",
        }),
      );
    }
    if (process.env.WORKER_ONCE === "1") break;
    if (!worked)
      for (let elapsed = 0; elapsed < 2000 && !stopping; elapsed += 100)
        await new Promise((r) => setTimeout(r, 100));
  }
} finally {
  await pool.end();
}
