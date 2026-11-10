import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileIngestionStore } from "../packages/ingestion/src/file";
import { QueueWorker } from "../packages/ingestion/src/worker";

it("地区来源由服务端配置确定并沿任务、观测时次和数据查询保持一致", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-tianqing-store-"));
  try {
    let xianSource: "mock" | "tianqing" = "tianqing";
    const store = new FileIngestionStore(dir, (sceneId) =>
      sceneId === "xian" ? xianSource : "mock",
    );
    const cursor = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000)
      .toISOString();
    await expect(
      store.enqueue(
        "tenant-a",
        "xian",
        { source: "mock", startTime: cursor, endTime: cursor },
        "admin",
      ),
    ).rejects.toThrow("来源与地区服务端配置不匹配");
    const job = await store.enqueue(
      "tenant-a",
      "xian",
      { source: "tianqing", startTime: cursor, endTime: cursor },
      "admin",
    );
    expect(job.source).toBe("tianqing");
    const worker = new QueueWorker(store, {
      async fetch(sceneId, time, _signal, source) {
        expect(sceneId).toBe("xian");
        expect(source).toBe("tianqing");
        return [{
          source: "tianqing",
          stationId: "61001",
          observedAt: time,
          ingestedAt: new Date().toISOString(),
          location: { lon: 108.94, lat: 34.34, crs: "EPSG:4326" },
          elements: { temperatureC: 12, rainfallMm: null, windSpeedMs: 2 },
          quality: { adapter: "tianqing" },
        }];
      },
    });
    await worker.tick();
    const status = await store.status("tenant-a", "xian");
    expect(status.source).toBe("tianqing");
    expect(status.jobs[0].status).toBe("succeeded");
    expect(await store.times("tenant-a", "xian")).toEqual([cursor]);
    expect((await store.observations("tenant-a", "xian", cursor))[0].source)
      .toBe("tianqing");

    xianSource = "mock";
    const mockView = new FileIngestionStore(dir, (sceneId) =>
      sceneId === "xian" ? xianSource : "mock",
    );
    expect((await mockView.status("tenant-a", "xian")).watermark).toBeNull();
    expect(await mockView.times("tenant-a", "xian")).toEqual([]);
    const secondTime = new Date(Date.parse(cursor) - 3600000).toISOString();
    const oldMockJob = await mockView.enqueue(
      "tenant-a", "xian",
      { source: "mock", startTime: secondTime, endTime: secondTime },
      "admin",
    );
    xianSource = "tianqing";
    const tianqingJob = await store.enqueue(
      "tenant-a", "xian",
      { source: "tianqing", startTime: secondTime, endTime: secondTime },
      "admin",
    );
    expect(tianqingJob.source).toBe("tianqing");
    expect(tianqingJob.id).not.toBe(oldMockJob.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
