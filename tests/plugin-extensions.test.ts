import { expect, test, vi } from "vitest";
import {
  ExtensionRegistry,
  parseProviderFrame,
  PluginRequests,
} from "../packages/sdk/src/extensions";
test("扩展注册采用所有者命名空间，拒绝HTML与无效坐标，卸载互不影响", () => {
  const registry = new ExtensionRegistry();
  registry.register("customer.weather", "route", {
    id: "customer.weather.page",
    title: "客户专题",
    description: "纯文本",
    rows: [{ label: "来源", value: "Mock" }],
  });
  registry.register("customer.other", "widget", {
    id: "customer.other.card",
    title: "站点总数",
    value: "6",
    description: "Mock",
  });
  expect(() =>
    registry.register("customer.weather", "widget", {
      id: "customer.other.card",
      title: "覆盖",
      value: "1",
    }),
  ).toThrow();
  expect(() =>
    registry.register("customer.weather", "route", {
      id: "customer.weather.bad",
      title: "恶意",
      html: "<script />",
    }),
  ).toThrow();
  expect(() =>
    registry.register("customer.weather", "route", {
      id: "customer.weather.bad",
      title: "越界",
      action: { label: "定位", lon: 190, lat: 30 },
    }),
  ).toThrow();
  registry.removeOwner("customer.weather");
  expect(registry.routes()).toHaveLength(0);
  expect(registry.widgets()).toHaveLength(1);
});
test("Provider校验来源/请求时次/数量，不得伪装来源或返回其他时次", () => {
  const frame = {
    source: "mock",
    observedAt: "2026-11-07T12:00:00+08:00",
    unit: "°C",
    crs: "EPSG:4326",
    observations: [],
  };
  expect(parseProviderFrame(frame, "mock", frame.observedAt).source).toBe(
    "mock",
  );
  expect(() =>
    parseProviderFrame({ ...frame, source: "other" }, "mock", frame.observedAt),
  ).toThrow();
  expect(() =>
    parseProviderFrame(frame, "mock", "2026-11-07T11:00:00+08:00"),
  ).toThrow();
});
test("Provider请求取消、超时、卸载后全部结束且迟到结果被忽略", async () => {
  vi.useFakeTimers();
  try {
    const sent: string[] = [],
      requests = new PluginRequests((id) => sent.push(id), 100);
    const controller = new AbortController();
    const first = requests
      .request("a", controller.signal)
      .catch((e: Error) => e.message);
    controller.abort();
    expect(await first).toContain("取消");
    expect(requests.resolve(sent[0], "迟到")).toBe(false);
    const second = requests.request("b").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(101);
    expect(await second).toContain("超时");
    const third = requests.request("c").catch((e: Error) => e.message);
    requests.dispose();
    expect(await third).toContain("卸载");
    await expect(requests.request("d")).rejects.toThrow("卸载");
  } finally {
    vi.useRealTimers();
  }
});
