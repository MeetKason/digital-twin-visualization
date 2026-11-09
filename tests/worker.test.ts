import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIngestionStore } from "../packages/ingestion/src/file";
import {
  QueueWorker,
  MockSceneConnector,
} from "../packages/ingestion/src/worker";
it("Worker 失败不写入，重试按任务地区执行且不持久化敏感错误", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-worker-"));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
  try {
    const store = new FileIngestionStore(dir);
    await store.enqueue(
      "alpha",
      "taiyuan",
      {
        source: "mock",
        startTime: "2026-11-07T00:00:00Z",
        endTime: "2026-11-07T00:00:00Z",
      },
      "a",
    );
    const failed = new QueueWorker(store, {
      fetch: async () => {
        throw new Error("upstream secret-token");
      },
    });
    await failed.tick();
    expect(await store.times("alpha", "taiyuan")).toEqual([]);
    expect(
      JSON.stringify(await store.status("alpha", "taiyuan")),
    ).not.toContain("secret-token");
    vi.setSystemTime(new Date("2026-11-09T00:00:06Z"));
    await new QueueWorker(store).tick();
    expect((await store.status("alpha", "taiyuan")).jobs[0].status).toBe(
      "succeeded",
    );
    const rows = await store.observations(
      "alpha",
      "taiyuan",
      "2026-11-07T00:00:00.000Z",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) => r.source === "mock" && r.stationId.startsWith("taiyuan"),
      ),
    ).toBe(true);
    expect(await store.times("alpha", "xian")).toEqual([]);
  } finally {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  }
});
it("Worker 无效观测进入重试且水位不推进", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-worker-invalid-"));
  try {
    const store = new FileIngestionStore(dir),
      connector = new MockSceneConnector();
    await store.enqueue(
      "alpha",
      "xian",
      {
        source: "mock",
        startTime: "2026-11-07T00:00:00Z",
        endTime: "2026-11-07T00:00:00Z",
      },
      "a",
    );
    await new QueueWorker(store, {
      fetch: async (scene, time) => {
        const rows = await connector.fetch(scene, time);
        rows[0].location.lat = NaN;
        return rows;
      },
    }).tick();
    const state = await store.status("alpha", "xian");
    expect(state.watermark).toBeNull();
    expect(state.jobs[0].status).toBe("retrying");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
