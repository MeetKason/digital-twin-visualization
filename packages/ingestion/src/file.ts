import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { IngestionStore, type States, type WriteRows } from "./state";
// Development only: one API process owns this instance and its embedded executor.
export class FileIngestionStore extends IngestionStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string) {
    super();
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
          async (state, rows) => {
            const time = new Date(rows[0].observedAt).toISOString();
            state.frames[time] = rows;
            const times = Object.keys(state.frames).sort();
            for (const old of times.slice(0, Math.max(0, times.length - 1000)))
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
