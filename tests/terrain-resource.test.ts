import { afterEach, expect, test, vi } from "vitest";
import { Request, Resource } from "cesium";
import { TerrainResourceClient } from "../apps/web/src/terrainResource";
afterEach(() => vi.restoreAllMocks());

test("Cesium公开Resource支持单瓦片取消、地图销毁及忙时返回undefined", async () => {
  const requests = Array.from({ length: 5 }, () => new Request());
  let count = 0;
  vi.spyOn(Resource.prototype, "fetchArrayBuffer").mockImplementation(() => {
    const request = requests[count++];
    return new Promise<ArrayBuffer>((_resolve, reject) => { request.cancelFunction = () => reject(new DOMException("取消", "AbortError")); });
  });
  const client = new TerrainResourceClient();
  const pending = requests.slice(0, 4).map((request, index) => client.load(`https://test.invalid/${index}`, request)!);
  expect(client.load("https://test.invalid/5", requests[4])).toBeUndefined();
  requests[0].cancelFunction();
  await expect(pending[0]).rejects.toHaveProperty("name", "AbortError");
  client.dispose();
  expect((await Promise.allSettled(pending)).every((result) => result.status === "rejected")).toBe(true);
});

test("成功瓦片复用缓存，未获调度名额时不占并发", async () => {
  const fetcher = vi.spyOn(Resource.prototype, "fetchArrayBuffer");
  fetcher.mockReturnValueOnce(undefined);
  const client = new TerrainResourceClient();
  expect(client.load("https://test.invalid/tile", new Request())).toBeUndefined();
  fetcher.mockResolvedValue(new Uint8Array([1, 2]).buffer);
  expect(await client.load("https://test.invalid/tile", new Request())).toEqual(new Uint8Array([1, 2]));
  await client.load("https://test.invalid/tile", new Request());
  expect(fetcher).toHaveBeenCalledTimes(2);
  client.dispose();
});


test("底层abort不结束Promise时，销毁仍释放本地并发名额", async () => {
  vi.spyOn(Resource.prototype, "fetchArrayBuffer").mockImplementation(() => new Promise<ArrayBuffer>(() => {}));
  const client = new TerrainResourceClient();
  const tasks = Array.from({ length: 4 }, (_, i) => client.load(`https://test.invalid/hang/${i}`, new Request())!);
  client.dispose();
  expect((await Promise.allSettled(tasks)).every((item) => item.status === "rejected")).toBe(true);
  const next = new TerrainResourceClient();
  const task = next.load("https://test.invalid/new", new Request());
  expect(task).not.toBeUndefined();
  next.dispose();
  await expect(task).rejects.toHaveProperty("name", "AbortError");
});
