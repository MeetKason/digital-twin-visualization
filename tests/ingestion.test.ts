import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("逐时补数重启恢复、失败重试、租约围栏和租户隔离", async () => {
  const module = await import("../packages/ingestion/src/file").catch(
    () => null,
  );
  expect(module, "持久采集队列尚未实现").not.toBeNull();
  if (!module) return;
  const { FileIngestionStore } = module;
  const dir = await mkdtemp(join(tmpdir(), "dtv-ingest-"));
  try {
    const store = new FileIngestionStore(dir);
    const input = {
      source: "mock" as const,
      startTime: "2026-11-07T00:00:00Z",
      endTime: "2026-11-07T01:00:00Z",
    };
    const job = await store.enqueue("alpha", "xian", input, "a");
    expect((await store.enqueue("alpha", "xian", input, "a")).id).toBe(job.id);
    expect((await store.status("beta", "xian")).jobs).toHaveLength(0);
    const lease = await store.claim("worker-1", 1000);
    expect(lease?.job.id).toBe(job.id);
    expect(await store.claim("worker-2", 1000)).toBeNull();
    const { MockSceneConnector } = await import(
      "../packages/ingestion/src/worker"
    );
    const rows = await new MockSceneConnector().fetch(
      "xian",
      lease!.job.cursor,
    );
    expect(await store.complete(lease!, rows, 1001)).toBe(true);
    const restarted = new FileIngestionStore(dir);
    expect((await restarted.status("alpha", "xian")).watermark).toBe(
      "2026-11-07T00:00:00.000Z",
    );
    const second = await restarted.claim("worker-2", 1002);
    expect(second?.job.cursor).toBe("2026-11-07T01:00:00.000Z");
    await restarted.fail(second!, "upstream unavailable", 1003);
    expect((await restarted.status("alpha", "xian")).watermark).toBe(
      "2026-11-07T00:00:00.000Z",
    );
    expect(await restarted.claim("worker-3", 1004)).toBeNull();
    const retry = await restarted.claim("worker-3", 10000);
    expect(retry?.job.cursor).toBe(second?.job.cursor);
    // Reclaim an expired lease, then reject the old worker's successful result.
    const reclaimed = await restarted.claim("worker-4", 140001);
    expect(reclaimed?.token).not.toBe(retry?.token);
    const lastRows = await new MockSceneConnector().fetch(
      "xian",
      reclaimed!.job.cursor,
    );
    expect(await restarted.complete(retry!, lastRows, 140002)).toBe(false);
    expect(await restarted.complete(reclaimed!, lastRows, 140002)).toBe(true);
    const state = await restarted.status("alpha", "xian");
    expect(state.jobs[0].status).toBe("succeeded");
    expect(state.jobs[0].completedHours).toBe(2);
    expect(await restarted.times("alpha", "xian")).toEqual([
      "2026-11-07T00:00:00.000Z",
      "2026-11-07T01:00:00.000Z",
    ]);
    expect(
      await restarted.observations("beta", "xian", "2026-11-07T00:00:00.000Z"),
    ).toEqual([]);
    const next = await restarted.enqueue("alpha", "taiyuan", input, "a");
    const pending = await restarted.claim("worker-1", 150000);
    await restarted.cancel("alpha", "taiyuan", next.id);
    expect(
      await restarted.complete(
        pending!,
        await new MockSceneConnector().fetch("taiyuan", pending!.job.cursor),
        150001,
      ),
    ).toBe(false);
    expect(await restarted.times("alpha", "taiyuan")).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("连续失败进入失败队列，人工重试续传，补旧资料不回退水位", async () => {
  const { FileIngestionStore } = await import("../packages/ingestion/src/file");
  const { MockSceneConnector } = await import(
    "../packages/ingestion/src/worker"
  );
  const dir = await mkdtemp(join(tmpdir(), "dtv-ingest-retry-"));
  try {
    const store = new FileIngestionStore(dir),
      connector = new MockSceneConnector();
    const input = {
      source: "mock" as const,
      startTime: "2026-11-07T02:00:00Z",
      endTime: "2026-11-07T02:00:00Z",
    };
    const job = await store.enqueue("a", "xian", input, "a");
    for (let attempt = 0; attempt < 3; attempt++) {
      const lease = await store.claim("w", attempt * 20000);
      await store.fail(lease!, "test failure", attempt * 20000 + 1);
    }
    expect((await store.status("a", "xian")).jobs[0].status).toBe("failed");
    expect((await store.status("a", "xian")).watermark).toBeNull();
    await expect(store.retry("b", "xian", job.id)).rejects.toThrow("不存在");
    await store.retry("a", "xian", job.id);
    const lease = await store.claim("w", 100000);
    const rows = await connector.fetch("xian", lease!.job.cursor);
    const invalid = structuredClone(rows);
    invalid[0].elements.temperatureC = NaN;
    await expect(store.complete(lease!, invalid, 100001)).rejects.toThrow(
      "契约",
    );
    expect(await store.times("a", "xian")).toEqual([]);
    await store.complete(lease!, rows, 100002);
    await store.enqueue(
      "a",
      "xian",
      {
        ...input,
        startTime: "2026-11-07T01:00:00Z",
        endTime: "2026-11-07T01:00:00Z",
      },
      "a",
    );
    const old = await store.claim("w", 110000);
    await store.complete(
      old!,
      await connector.fetch("xian", old!.job.cursor),
      110001,
    );
    expect((await store.status("a", "xian")).watermark).toBe(
      "2026-11-07T02:00:00.000Z",
    );
    expect(await store.complete(old!, rows, 110002)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("每小时计划显式启停、重启去重、输入范围和排队容量校验", async () => {
  const { FileIngestionStore } = await import("../packages/ingestion/src/file");
  const dir = await mkdtemp(join(tmpdir(), "dtv-ingest-schedule-"));
  try {
    const store = new FileIngestionStore(dir);
    const time = new Date(
      Math.floor(Date.now() / 3600000) * 3600000,
    ).toISOString();
    await store.status("a", "xian");
    expect(await store.claim("w")).toBeNull();
    await store.configure("a", "xian", { enabled: true });
    const first = await store.claim("w");
    expect(first?.job.kind).toBe("scheduled");
    expect(first?.job.cursor).toBe(time);
    expect(await new FileIngestionStore(dir).claim("w2")).toBeNull();
    await store.configure("a", "xian", { enabled: false });
    await store.cancel("a", "xian", first!.job.id);
    expect(await store.claim("w")).toBeNull();
    await expect(
      store.enqueue(
        "a",
        "xian",
        {
          source: "mock",
          startTime: "2099-01-01T00:00:00Z",
          endTime: "2099-01-01T00:00:00Z",
        },
        "a",
      ),
    ).rejects.toThrow("未来");
    await expect(
      store.enqueue(
        "a",
        "xian",
        {
          source: "mock",
          startTime: "2026-01-01T00:00:00Z",
          endTime: "2026-02-01T00:00:00Z",
        },
        "a",
      ),
    ).rejects.toThrow("168");
    for (let i = 0; i < 20; i++) {
      const t = new Date(Date.parse(time) - (i + 1) * 3600000).toISOString();
      await store.enqueue(
        "a",
        "xian",
        { source: "mock", startTime: t, endTime: t },
        "a",
      );
    }
    const t = new Date(Date.parse(time) - 30 * 3600000).toISOString();
    await expect(
      store.enqueue(
        "a",
        "xian",
        { source: "mock", startTime: t, endTime: t },
        "a",
      ),
    ).rejects.toThrow("20");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("定时计划使用事务时钟，人工重试也不能绕过排队上限", async () => {
  const { FileIngestionStore } = await import("../packages/ingestion/src/file");
  const dir = await mkdtemp(join(tmpdir(), "dtv-ingest-clock-"));
  try {
    const store = new FileIngestionStore(dir);
    await store.configure("clock", "xian", { enabled: true });
    const authoritativeNow = Date.now() + 3600000;
    const lease = await store.claim("clock-skewed-worker", authoritativeNow);
    expect(lease?.job.cursor).toBe(
      new Date(Math.floor(authoritativeNow / 3600000) * 3600000).toISOString(),
    );
    await store.configure("clock", "xian", { enabled: false });
    await store.cancel("clock", "xian", lease!.job.id);
    const input = {
      source: "mock" as const,
      startTime: "2026-11-07T00:00:00Z",
      endTime: "2026-11-07T00:00:00Z",
    };
    const failed = await store.enqueue("a", "xian", input, "a");
    for (let i = 0; i < 3; i++) {
      const l = await store.claim("w", i * 20000);
      await store.fail(l!, "fail", i * 20000 + 1);
    }
    for (let i = 1; i <= 20; i++) {
      const time = new Date(
        Date.parse(input.startTime) + i * 3600000,
      ).toISOString();
      await store.enqueue(
        "a",
        "xian",
        { source: "mock", startTime: time, endTime: time },
        "a",
      );
    }
    await expect(store.retry("a", "xian", failed.id)).rejects.toThrow("20");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
