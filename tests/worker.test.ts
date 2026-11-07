import { it, expect } from "vitest";
import {
  IngestRunner,
  MemoryStore,
  MockConnector,
} from "../apps/worker/src/index";
it("幂等入库和成功后推进水位线，失败保留原水位", async () => {
  const store = new MemoryStore(),
    connector = new MockConnector();
  const runner = new IngestRunner(connector, store);
  await runner.run("2026-11-07T00:00:00Z");
  const n = store.rows.size;
  await runner.run("2026-11-07T00:00:00Z");
  expect(store.rows.size).toBe(n);
  expect(store.watermark).toBe("2026-11-07T00:00:00Z");
  store.failNext = true;
  await expect(runner.run("2026-11-07T01:00:00Z")).rejects.toThrow();
  expect(store.watermark).toBe("2026-11-07T00:00:00Z");
});

it("无效纬度不能提交到持久层", async () => {
  const store = new MemoryStore();
  const connector = new MockConnector();
  const rows = await connector.fetch("2026-11-07T00:00:00Z");
  rows[0].location.lat = NaN;
  await expect(
    new IngestRunner({ fetch: async () => rows }, store).run(
      "2026-11-07T00:00:00Z",
    ),
  ).rejects.toThrow("契约");
  expect(store.rows.size).toBe(0);
});
