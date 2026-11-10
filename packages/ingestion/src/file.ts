import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  IngestionStore,
  type IngestionSource,
  type States,
  type WriteRows,
} from "./state";
import { frameKey } from "./state";
import type { IngestionProduct } from "./products";
// 仅用于开发单进程：由单个 API 实例独占文件仓库和内嵌任务执行器。
export class FileIngestionStore extends IngestionStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly dir: string,
    resolveSource: (sceneId: string, productId?: string) => IngestionSource = () => "mock",
    products?: IngestionProduct[],
  ) {
    super(resolveSource, products);
  }
  protected transaction<T>(
    _scope: [string, string] | null,
    work: (states: States, write: WriteRows, clock: number) => Promise<T>,
  ): Promise<T> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const path = join(this.dir, "ingestion.json");
        let states: States;
        try {
          states = JSON.parse(await readFile(path, "utf8"));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          states = {};
        }
        const before = JSON.stringify(states);
        const result = await work(
          states,
          async (state, rows, productId) => {
            const time = new Date(rows[0].observedAt).toISOString();
            state.frames[frameKey(productId, time)] = rows;
            const keys = Object.keys(state.frames).filter((key) => {
              try { return JSON.parse(key)[0] === productId; } catch { return productId === "surface-hourly"; }
            }).sort();
            for (const old of keys.slice(0, Math.max(0, keys.length - 1000)))
              delete state.frames[old];
          },
          Date.now(),
        );
        const after = JSON.stringify(states);
        if (after !== before) {
          await mkdir(this.dir, { recursive: true, mode: 0o700 });
          const temp = join(this.dir, `.ingestion-${randomUUID()}.tmp`);
          try {
            await writeFile(temp, after, { mode: 0o600, flag: "wx" });
            await rename(temp, path);
          } finally {
            await rm(temp, { force: true });
          }
        }
        return result;
      });
    this.queue = task;
    return task;
  }
}
