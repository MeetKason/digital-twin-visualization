import { afterEach, expect, test, vi } from "vitest";
import { TerrainRequestQueue, TerrainTileClient } from "../apps/web/src/terrainRequests";
afterEach(() => vi.unstubAllGlobals());

test("排队请求可取消，释放连接后新场景不会被旧队列阻塞", async () => {
  const queue = new TerrainRequestQueue(1);
  let finish!: () => void;
  const active = queue.run(() => new Promise<void>((resolve) => { finish = resolve; }), new AbortController().signal);
  const old = new AbortController();
  const stale = vi.fn();
  const cancelled = queue.run(stale, old.signal);
  old.abort();
  await expect(cancelled).rejects.toHaveProperty("name", "AbortError");
  const latest = vi.fn(async () => "new");
  const next = queue.run(latest, new AbortController().signal);
  finish();
  await active;
  expect(await next).toBe("new");
  expect(stale).not.toHaveBeenCalled();
});

test("并发限制覆盖响应体读取，关闭客户端中止在途和排队请求", async () => {
  const queue = new TerrainRequestQueue(1);
  const fetcher = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("取消", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetcher);
  const client = new TerrainTileClient(queue);
  const first = client.load("one");
  const second = client.load("two");
  expect(fetcher).toHaveBeenCalledTimes(1);
  client.dispose();
  const result = await Promise.allSettled([first, second]);
  expect(result.every((item) => item.status === "rejected")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(client.load("three")).rejects.toHaveProperty("name", "AbortError");
});

test("不重试授权失败，瞬时5xx重试一次，成功瓦片复用且有缓存上限", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetcher);
  const client = new TerrainTileClient(new TerrainRequestQueue(2), { cacheSize: 1, retryDelayMs: 0 });
  fetcher.mockResolvedValueOnce(new Response("", { status: 403 }));
  await expect(client.load("denied")).rejects.toThrow("403");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(new Response("", { status: 503 }));
  expect(await client.load("tile")).toEqual(new Uint8Array([1, 2, 3]));
  await client.load("tile");
  expect(fetcher).toHaveBeenCalledTimes(3);
  await client.load("other");
  await client.load("tile");
  expect(fetcher).toHaveBeenCalledTimes(5);
  client.dispose();
});

test("视野变化只取消该瓦片，其余瓦片继续加载", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    if (url === "keep") return new Promise<Response>((resolve) => { finish = resolve; });
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("取消", "AbortError"))));
  }));
  const client = new TerrainTileClient(new TerrainRequestQueue(2));
  const tile = new AbortController();
  const cancelled = client.load("cancel", tile.signal);
  const keep = client.load("keep");
  tile.abort();
  await expect(cancelled).rejects.toHaveProperty("name", "AbortError");
  finish(new Response(new Uint8Array([9])));
  expect(await keep).toEqual(new Uint8Array([9]));
  client.dispose();
});
