import { Resource, type Request as CesiumRequest } from "cesium";

let active = 0;
const maximum = 4;

/** 使用Cesium公开Resource接入其取消调度；超出并发时返回undefined，由引擎下帧重试。 */
export class TerrainResourceClient {
  private disposed = false;
  private pending = new Set<() => void>();
  private cache = new Map<string, Uint8Array>();
  load(url: string, request: CesiumRequest): Promise<Uint8Array> | undefined {
    if (this.disposed) return Promise.reject(new DOMException("地图已释放", "AbortError"));
    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url); this.cache.set(url, cached);
      return Promise.resolve(cached.slice());
    }
    if (active >= maximum) return undefined;
    const resource = new Resource({ url, request, retryAttempts: 1,
      retryCallback: (_resource, error) => Promise.resolve(!this.disposed && ((error?.statusCode ?? 0) === 0 || error?.statusCode === 429 || (error?.statusCode ?? 0) >= 500)),
    });
    // Resource会将XHR取消函数写入传入的Request；不访问Cesium私有状态。
    const operation = resource.fetchArrayBuffer();
    if (!operation) return undefined;
    active++;
    let rejectCancelled!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const cancel = () => {
      // Cesium 1.147的类型未暴露cancel，但只中断XHR不会释放其调度队列。
      // 兼容入口集中在此，升级Cesium时必须执行地形取消与重建浏览器回归。
      const cancellable = request as CesiumRequest & { cancel?: () => void };
      cancellable.cancel?.();
      request.cancelFunction?.();
      // XHR.abort不保证原Promise立即结束，显式释放本实例持有的并发名额。
      rejectCancelled(new DOMException("地形请求已取消", "AbortError"));
    };
    this.pending.add(cancel);
    const timer = setTimeout(cancel, 15000);
    return Promise.race([operation, cancelled]).then((buffer) => {
      if (this.disposed) throw new DOMException("地图已释放", "AbortError");
      const bytes = new Uint8Array(buffer);
      this.cache.set(url, bytes);
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
      return bytes.slice();
    }).finally(() => {
      clearTimeout(timer);
      this.pending.delete(cancel);
      active--;
    });
  }
  dispose() {
    this.disposed = true;
    for (const cancel of this.pending) cancel();
    this.pending.clear(); this.cache.clear();
  }
}
