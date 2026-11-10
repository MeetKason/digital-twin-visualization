import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { expect, it } from "vitest";

const listen = async (server: Server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
};
const freePort = async () => {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

it("启用地区天擎配置后，API 忽略客户端来源并把真实观测送入地图查询", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-tianqing-api-"));
  let child: ChildProcess | undefined;
  const requests: URL[] = [];
  const upstream = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push(url);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      returnCode: 0,
      DS: [{
        Station_Id_C: "61001",
        Datetime: "20261109020000",
        Lon: "108.94",
        Lat: "34.34",
        TEM: "12.5",
        PRE_1H: "0.2",
        WIN_S_2MI: "3.2",
      }],
    }));
  });
  const upstreamPort = await listen(upstream);
  const appPort = await freePort();
  const base = `http://127.0.0.1:${appPort}/api`;
  let logs = "";
  try {
    await writeFile(join(dir, "sources.json"), JSON.stringify({
      profiles: {
        hourly: {
          interfaceId: "getSurfEleInRegionByTime",
          dataCode: "SURF_CHN_MUL_HOR",
          elements: "Station_Id_C,Datetime,Lon,Lat,TEM,PRE_1H,WIN_S_2MI",
          timeParameter: "times",
          regionParameter: "adminCodes",
          limitCnt: 3000,
          requestTimeZone: "UTC",
          observationTimeZone: "Asia/Shanghai",
          fieldMap: {
            stationId: "Station_Id_C",
            observedAt: "Datetime",
            longitude: "Lon",
            latitude: "Lat",
            temperatureC: "TEM",
            rainfallMm: "PRE_1H",
            windSpeedMs: "WIN_S_2MI",
          },
        },
      },
      scenes: {
        xian: {
          enabled: true,
          baseUrl: `http://127.0.0.1:${upstreamPort}/music-ws/api`,
          userId: "xian-user",
          password: "integration-secret",
          regionCode: "610100",
          serviceNodeId: "NMIC_MUSIC_CMADAAS",
          profile: "hourly",
        },
      },
    }));
    child = spawn(process.execPath, ["--import", "tsx", "apps/core-api/src/main.ts"], {
      env: {
        ...process.env,
        PORT: String(appPort),
        DATA_DIR: dir,
        AUTH_USERS_FILE: "",
        DEMO_ENABLED: "true",
        DATABASE_URL: "",
        PGHOST: "",
        DTV_TIANQING_CONFIG_FILE: join(dir, "sources.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => (logs += String(chunk)));
    child.stderr?.on("data", (chunk) => (logs += String(chunk)));
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(base + "/health")).ok) {
          ready = true;
          break;
        }
      } catch {
        // 等待本地 API 启动，不触碰真实天擎地址。
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready, logs).toBe(true);

    const demo = await fetch(base + "/auth/demo", {
      method: "POST",
      headers: { "X-DTV-Request": "1" },
    });
    expect(demo.status).toBe(201);
    const cookie = demo.headers.get("set-cookie")!.split(";")[0];
    const call = (path: string, method = "GET", body?: unknown) => fetch(base + path, {
      method,
      headers: {
        Cookie: cookie,
        "X-DTV-Request": "1",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const statusResponse = await call("/scenes/xian/ingestion");
    expect((await statusResponse.json()).source).toBe("tianqing");
    expect((await call("/scenes/xian/ingestion/config", "PUT", { mode: "ingested" })).status).toBe(200);
    const time = "2026-11-08T18:00:00.000Z";
    expect((await call("/scenes/xian/ingestion/jobs", "POST", {
      source: "mock",
      startTime: time,
      endTime: time,
    })).status).toBe(201);

    let current: { jobs: Array<{ status: string }>; watermark: string | null } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      current = await (await call("/scenes/xian/ingestion")).json();
      if (current?.jobs[0]?.status === "succeeded") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(current?.jobs[0]?.status, logs).toBe("succeeded");
    expect(current?.watermark).toBe(time);
    const frameResponse = await call(
      `/layers/temperature/data?sceneId=xian&time=${encodeURIComponent(time)}`,
    );
    expect(frameResponse.status).toBe(200);
    const frame = await frameResponse.json();
    expect(frame.source).toBe("tianqing");
    expect(frame.observations[0].elements.temperatureC).toBe(12.5);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("userId")).toBe("xian-user");
    expect(requests[0].searchParams.get("adminCodes")).toBe("610100");
    expect(requests[0].searchParams.get("pwd")).toBeNull();
    expect(logs).not.toContain("integration-secret");
  } finally {
    if (child && child.exitCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      await ended;
    }
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
