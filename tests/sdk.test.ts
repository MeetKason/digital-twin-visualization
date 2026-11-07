import { describe, it, expect, vi } from "vitest";
import { LayerRuntime, PluginManager } from "../packages/sdk/src/index";
import type { LayerHandle, PlatformContext } from "../packages/sdk/src/index";
const handle = (): LayerHandle => ({
  setOpacity: vi.fn(),
  setTime: vi.fn(),
  dispose: vi.fn(),
});
describe("图层生命周期", () => {
  it("关闭后异步返回的旧图层必须释放，不能重新开启", async () => {
    let resolve!: (h: LayerHandle) => void;
    const runtime = new LayerRuntime(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = runtime.toggle("temperature", true);
    await runtime.toggle("temperature", false);
    const h = handle();
    resolve(h);
    await first;
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(runtime.snapshot("temperature").status).toBe("off");
  });
  it("透明度仅改变目标图层，范围限制到 0–1，卸载释放全部资源", async () => {
    const a = handle(),
      b = handle();
    const runtime = new LayerRuntime(async (id) => (id === "a" ? a : b));
    await runtime.toggle("a", true);
    await runtime.toggle("b", true);
    runtime.setOpacity("a", 0.3);
    expect(a.setOpacity).toHaveBeenLastCalledWith(0.3);
    expect(b.setOpacity).not.toHaveBeenCalledWith(0.3);
    expect(() => runtime.setOpacity("a", 2)).toThrow();
    runtime.dispose();
    expect(a.dispose).toHaveBeenCalledOnce();
    expect(b.dispose).toHaveBeenCalledOnce();
  });
  it("失败可重试，旧错误不得覆盖新状态", async () => {
    let attempts = 0;
    const runtime = new LayerRuntime(async () => {
      if (!attempts++) throw new Error("示例失败");
      return handle();
    });
    await runtime.toggle("a", true);
    expect(runtime.snapshot("a").status).toBe("error");
    await runtime.toggle("a", true);
    expect(runtime.snapshot("a").status).toBe("on");
  });
});
describe("插件契约", () => {
  it("卸载调用清理；不兼容 SDK 拒绝安装", async () => {
    const cleanup = vi.fn();
    const ctx = { apiVersion: "1.0.0" } as PlatformContext;
    const manager = new PluginManager(ctx);
    await manager.install({
      manifest: { id: "example", version: "1.0.0", coreApi: 1 },
      activate: async () => cleanup,
    });
    await manager.uninstall("example");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(manager.ids()).toEqual([]);
    await expect(
      manager.install({
        manifest: { id: "bad", version: "1", coreApi: 2 },
        activate: async () => cleanup,
      }),
    ).rejects.toThrow("SDK");
  });
});

it("加载过程中调整透明度，完成后必须保留最新值", async () => {
  let resolve!: (h: LayerHandle) => void;
  const runtime = new LayerRuntime(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const loading = runtime.toggle("a", true);
  runtime.setOpacity("a", 0.25);
  const h = handle();
  resolve(h);
  await loading;
  expect(runtime.snapshot("a").opacity).toBe(0.25);
  expect(h.setOpacity).toHaveBeenLastCalledWith(0.25);
});

it("并发安装同名插件不能重复注册", async () => {
  let resolve!: (cleanup: () => void) => void;
  const manager = new PluginManager({ apiVersion: "1.0.0" } as PlatformContext);
  const plugin = {
    manifest: { id: "same", version: "1", coreApi: 1 },
    activate: () =>
      new Promise<() => void>((r) => {
        resolve = r;
      }),
  };
  const first = manager.install(plugin);
  await expect(manager.install(plugin)).rejects.toThrow("插件");
  resolve(() => {});
  await first;
});
