import {
  demoObservations,
  SceneSchema,
  type WeatherObservation,
} from "@dtv/contracts";
import xian from "../../../scenarios/xian.json";
import taiyuan from "../../../scenarios/taiyuan.json";
import chengdu from "../../../scenarios/chengdu.json";
import type { IngestionStore } from "./state";
export interface SceneConnector {
  fetch(
    sceneId: string,
    time: string,
    signal?: AbortSignal,
  ): Promise<WeatherObservation[]>;
}
export class MockSceneConnector implements SceneConnector {
  async fetch(sceneId: string, time: string) {
    const config = [xian, taiyuan, chengdu].find((s) => s.id === sceneId);
    if (!config) throw new Error("未知场景");
    return demoObservations(SceneSchema.parse(config), time);
  }
}
export class QueueWorker {
  constructor(
    private readonly store: IngestionStore,
    private readonly connector: SceneConnector = new MockSceneConnector(),
    private readonly id = `worker-${process.pid}`,
  ) {}
  async tick() {
    const lease = await this.store.claim(this.id);
    if (!lease) return false;
    try {
      const signal = AbortSignal.timeout(30000);
      const rows = await Promise.race([
        this.connector.fetch(lease.sceneId, lease.job.cursor, signal),
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("采集超时")),
            { once: true },
          ),
        ),
      ]);
      await this.store.complete(lease, rows);
    } catch {
      // Keep customer responses, tokens and connection details out of persisted errors.
      await this.store.fail(
        lease,
        "采集或观测校验失败，请检查源与执行器日志后重试",
      );
    }
    return true;
  }
}
