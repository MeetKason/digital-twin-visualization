import { describe, expect, it, vi } from "vitest";
import {
  TianqingClient,
  loadTianqingConfig,
  buildTianqingUrl,
  signTianqingParameters,
  type TianqingConfig,
} from "../packages/ingestion/src/tianqing";

const profile: TianqingConfig["profiles"][string] = {
  interfaceId: "getSurfEleInRegionByTime",
  dataCode: "SURF_CHN_MUL_HOR",
  elements: "Station_Id_C,Datetime,Lon,Lat,TEM,PRE_1H,WIN_S_2MI",
  timeParameter: "times",
  regionParameter: "adminCodes",
  limitCnt: 3000,
  requestTimeZone: "UTC",
  observationTimeZone: "Asia/Shanghai",
  extraParameters: {},
  fieldMap: {
    stationId: "Station_Id_C",
    observedAt: "Datetime",
    longitude: "Lon",
    latitude: "Lat",
    temperatureC: "TEM",
    rainfallMm: "PRE_1H",
    windSpeedMs: "WIN_S_2MI",
  },
  nullValues: ["999999", "////"],
};
const sampleConfig = (): TianqingConfig => ({
  profiles: { hourly: profile },
  scenes: {
    xian: {
      enabled: true,
      baseUrl: "https://tianqing-xian.example.test/music-ws/api",
      userId: "xian-user",
      password: "xian-secret",
      regionCode: "610100",
      serviceNodeId: "NMIC_MUSIC_CMADAAS",
      profile: "hourly",
    },
    taiyuan: {
      enabled: true,
      baseUrl: "https://tianqing-taiyuan.example.test/api/query",
      userId: "taiyuan-user",
      password: "taiyuan-secret",
      regionCode: "140100",
      serviceNodeId: "NMIC_MUSIC_CMADAAS",
      profile: "hourly",
    },
  },
});

describe("天擎地区配置与协议", () => {
  it("按 ASCII key 顺序签名原始值，口令只作为单独签名参数", () => {
    expect(
      signTianqingParameters(
        {
          userId: "weather-test",
          timestamp: "123",
          interfaceId: "getSurfEleInRegionByTime",
          dataCode: "SURF_CHN_MUL_HOR",
          elements: "TEM,PRE_1H",
        },
        "密钥",
      ),
    ).toBe("0991C591C85CF92684B1AA6D35604644");
  });

  it("query 编码与 quote_plus 对齐，签名仍针对未编码原值", () => {
    const url = buildTianqingUrl(
      "https://example.test/api",
      { elements: "A,*,~ field", city: "西安" },
      "pwd",
    );
    expect(url).toContain("elements=A%2C%2A%2C~+field");
    expect(url).toContain("city=%E8%A5%BF%E5%AE%89");
    expect(new URL(url).searchParams.get("elements")).toBe("A,*,~ field");
    expect(url).not.toContain("pwd=pwd");
  });

  it("加载地区独立 endpoint 和账号，禁用或缺配置地区保持 Mock", () => {
    const config = loadTianqingConfig(sampleConfig());
    expect(config.sourceForScene("xian")).toBe("tianqing");
    expect(config.sourceForScene("chengdu")).toBe("mock");
    expect(config.forScene("xian")?.region.baseUrl).not.toBe(
      config.forScene("taiyuan")?.region.baseUrl,
    );
    expect(config.forScene("xian")?.region.password).not.toBe(
      config.forScene("taiyuan")?.region.password,
    );
  });

  it("拒绝不安全或带 query 的 endpoint 及缺失 profile", () => {
    const config = sampleConfig();
    config.scenes.xian.baseUrl = "http://user:pass@example.test/api?x=1";
    expect(() => loadTianqingConfig(config)).toThrow(/endpoint|地址|配置/i);
    config.scenes.xian.baseUrl = "https://example.test/api";
    config.scenes.xian.profile = "missing";
    expect(() => loadTianqingConfig(config)).toThrow(/profile|配置/i);
  });

  it("显式指定的地区配置文件缺失时启动报错，不静默回退 Mock", () => {
    expect(() => loadTianqingConfig(undefined, "/tmp/dtv-missing-tianqing-config.json"))
      .toThrow(/无法读取天擎地区配置/);
  });

  it("编码请求值并隐藏口令，成功时将天擎字段映射为标准观测", async () => {
    const config = loadTianqingConfig(sampleConfig());
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("pwd")).toBeNull();
      expect(url.searchParams.get("sign")).toMatch(/^[A-F0-9]{32}$/);
      expect(url.searchParams.get("elements")).toBe(profile.elements);
      expect(url.searchParams.get("adminCodes")).toBe("610100");
      return Response.json({
        returnCode: 0,
        DS: [
          {
            Station_Id_C: "61001",
            Datetime: "20261109020000",
            Lon: "108.94",
            Lat: "34.34",
            TEM: "12.5",
            PRE_1H: "////",
            WIN_S_2MI: "3.2",
          },
        ],
      });
    });
    const client = new TianqingClient(config, {
      fetcher,
      now: () => 1762646400000,
      nonce: () => "fixed-nonce",
      wait: async () => {},
    });
    const rows = await client.fetch("xian", "2026-11-08T18:00:00.000Z");
    expect(rows).toEqual([
      {
        source: "tianqing",
        stationId: "61001",
        observedAt: "2026-11-08T18:00:00.000Z",
        ingestedAt: new Date(1762646400000).toISOString(),
        location: { lon: 108.94, lat: 34.34, crs: "EPSG:4326" },
        elements: {
          temperatureC: 12.5,
          rainfallMm: null,
          windSpeedMs: 3.2,
        },
        quality: { adapter: "tianqing" },
      },
    ]);
    expect(String(fetcher.mock.calls[0][0])).toContain("%2C");
    expect(String(fetcher.mock.calls[0][0])).not.toContain("xian-secret");
  });

  it("地区间不串账号，429 后有限重试，非零 returnCode 不重试", async () => {
    const config = loadTianqingConfig(sampleConfig());
    let calls = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      calls++;
      const url = new URL(String(input));
      if (url.hostname.startsWith("tianqing-taiyuan")) {
        expect(url.searchParams.get("userId")).toBe("taiyuan-user");
        expect(url.searchParams.get("adminCodes")).toBe("140100");
      }
      if (calls === 1) return new Response("busy", { status: 429 });
      return Response.json({ returnCode: -1, returnMessage: "credential error", DS: [] });
    });
    const wait = vi.fn(async () => {});
    const client = new TianqingClient(config, { fetcher, wait, nonce: () => "n" });
    await expect(client.fetch("taiyuan", "2026-11-08T18:00:00.000Z")).rejects.toThrow(/天擎返回业务错误/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("达到 limitCnt 视为疑似截断，不返回不完整观测", async () => {
    const config = loadTianqingConfig(sampleConfig());
    const fetcher = vi.fn(async () => Response.json({ returnCode: 0, DS: Array(3000).fill({}) }));
    const client = new TianqingClient(config, { fetcher, wait: async () => {} });
    await expect(client.fetch("xian", "2026-11-08T18:00:00.000Z")).rejects.toThrow(/截断|limitCnt/);
  });
});
