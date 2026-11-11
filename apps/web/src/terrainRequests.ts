/** 全局限制地形并发，但排队任务受各地图实例的取消信号管理。 */
export class TerrainRequestQueue {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly maximum = 4) {}
  run<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        this.queue = this.queue.filter((item) => item !== start);
        reject(signal.reason ?? new DOMException("请求已取消", "AbortError"));
      };
      const start = () => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) { cancel(); return; }
        this.active++;
        // 连接占用直至响应体读完；把队列名额直接交给下一任务，避免并发突破上限。
        void (async () => {
          try { resolve(await request()); }
          catch (error) { reject(error); }
          finally {
            this.active--;
            this.queue.shift()?.();
          }
        })();
      };
      if (signal.aborted) { cancel(); return; }
      if (this.active < this.maximum) start();
      else {
        this.queue.push(start);
        signal.addEventListener("abort", cancel, { once: true });
      }
    });
  }
}
export const terrainRequestQueue = new TerrainRequestQueue();

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** 每个地图实例拥有缓存与生命周期；退出地图清空缓存并停止重试和排队。 */
export class TerrainTileClient {
  private controller = new AbortController();
  private cache = new Map<string, Uint8Array>();
  private pending = new Map<string, Promise<Uint8Array>>();
  constructor(
    private readonly queue = terrainRequestQueue,
    private readonly options: { cacheSize?: number; retryDelayMs?: number } = {},
  ) {}
  async load(url: string, tileSignal?: AbortSignal): Promise<Uint8Array> {
    const signal = tileSignal ? AbortSignal.any([this.controller.signal, tileSignal]) : this.controller.signal;
    signal.throwIfAborted();
    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url); this.cache.set(url, cached);
      return cached.slice();
    }
    let task = tileSignal ? undefined : this.pending.get(url);
    if (!task) {
      task = this.fetch(url, signal).then((bytes) => {
        signal.throwIfAborted();
        this.cache.set(url, bytes);
        if (this.cache.size > (this.options.cacheSize ?? 128)) this.cache.delete(this.cache.keys().next().value!);
        return bytes;
      }).finally(() => { if (!tileSignal) this.pending.delete(url); });
      if (!tileSignal) this.pending.set(url, task);
    }
    // Cesium可修改传入样本；调用方不能改变缓存或另一个请求持有的数组。
    return (await task).slice();
  }
  private async fetch(url: string, signal: AbortSignal) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      try {
        return await this.queue.run(async () => {
          const response = await fetch(url, {
            mode: "cors", cache: "no-store",
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          });
          if (!response.ok) {
            // 不将带密钥的URL写入错误信息或日志。
            const error = Object.assign(new Error(`天地图高程请求失败（HTTP ${response.status}）`), { status: response.status });
            await response.body?.cancel();
            throw error;
          }
          return new Uint8Array(await response.arrayBuffer());
        }, signal);
      } catch (error) {
        signal.throwIfAborted();
        lastError = error;
        const status = (error as { status?: number }).status;
        if (status && status !== 429 && status < 500) throw error;
      }
      if (attempt === 0) await delay(this.options.retryDelayMs ?? 350, signal);
    }
    throw lastError;
  }
  dispose() {
    this.controller.abort();
    this.cache.clear();
    this.pending.clear();
  }
}
