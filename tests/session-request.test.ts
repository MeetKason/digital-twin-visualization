import { afterEach, expect, test, vi } from "vitest";
import { activateSession, sessionFetch, subscribeSessionExpired } from "../apps/web/src/sessionRequest";

afterEach(() => { vi.unstubAllGlobals(); activateSession(); });

test("并发401只通知一次，并阻止失效后的轮询；重新登录后允许请求", async () => {
  activateSession();
  const listener = vi.fn();
  const unsubscribe = subscribeSessionExpired(listener);
  const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await Promise.allSettled([sessionFetch("/api/scenes"), sessionFetch("/api/audit")]);
  expect(listener).toHaveBeenCalledTimes(1);
  const count = fetcher.mock.calls.length;
  await expect(sessionFetch("/api/scenes")).rejects.toThrow("登录已失效");
  expect(fetcher).toHaveBeenCalledTimes(count);
  activateSession();
  await expect(sessionFetch("/api/scenes")).rejects.toThrow("登录已失效");
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

test("旧会话迟到的401不会踢出新登录，403也不会触发退出", async () => {
  activateSession();
  const listener = vi.fn();
  const unsubscribe = subscribeSessionExpired(listener);
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const old = sessionFetch("/api/scenes");
  activateSession();
  finish(new Response("{}", { status: 401 }));
  await expect(old).rejects.toThrow("登录已失效");
  expect(listener).not.toHaveBeenCalled();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
  expect((await sessionFetch("/api/audit")).status).toBe(403);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});


test("失效时取消其他在途请求，调用方取消也可以正常传递", async () => {
  activateSession();
  let waitingSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/scenes")) {
      waitingSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("取消", "AbortError")));
      });
    }
    return new Response("{}", { status: 401 });
  }));
  const waiting = sessionFetch("/api/scenes");
  const result = Promise.allSettled([waiting, sessionFetch("/api/audit")]);
  await result;
  expect(waitingSignal?.aborted).toBe(true);
  activateSession();
  const controller = new AbortController();
  const cancelled = sessionFetch("/api/scenes", { signal: controller.signal });
  controller.abort();
  await expect(cancelled).rejects.toHaveProperty("name", "AbortError");
});
