import { createServer } from "node:http";
import { once } from "node:events";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ExtensionServices } from "../apps/core-api/src/platform/extensionServices";
import { TenantLicensing } from "../apps/core-api/src/platform/licensing";
import { FileRepository } from "../apps/core-api/src/platform/repository";
import { licenseIssuer } from "./helpers/licenses";
const time = "2026-11-07T12:00:00+08:00";
test("扩展服务按固定租户与逻辑数据集映射，拒绝凭据URL和伪造来源/时次", async () => {
  let bad = false,
    calls = 0;
  const server = createServer((req, res) => {
    calls++;
    expect(req.headers.authorization).toBe(`Bearer ${"test-token-".repeat(4)}`);
    expect(req.headers["x-dtv-tenant"]).toBe("alpha");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        source: bad ? "other" : "mock",
        observedAt: time,
        unit: "°C",
        crs: "EPSG:4326",
        observations: [],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const original = process.env.DTV_TEST_EXTENSION_TOKEN;
  process.env.DTV_TEST_EXTENSION_TOKEN = "test-token-".repeat(4);
  try {
    const entry = {
      tenantId: "alpha",
      datasetKey: "customer-data",
      url: `http://127.0.0.1:${port}/observations`,
      tokenEnv: "DTV_TEST_EXTENSION_TOKEN",
      source: "mock",
      unit: "°C",
    };
    const services = new ExtensionServices([entry]);
    expect(services.has("beta", "customer-data")).toBe(false);
    expect(
      () =>
        new ExtensionServices([
          { ...entry, url: "http://user:pass@127.0.0.1/a" },
        ]),
    ).toThrow();
    expect(() => new ExtensionServices([entry, entry])).toThrow();
    expect(
      (await services.observations("alpha", "xian", "customer-data", time))
        .source,
    ).toBe("mock");
    await expect(
      services.observations("beta", "xian", "customer-data", time),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    bad = true;
    await expect(
      services.observations("alpha", "xian", "customer-data", time),
    ).rejects.toThrow("合同");
  } finally {
    if (original === undefined) delete process.env.DTV_TEST_EXTENSION_TOKEN;
    else process.env.DTV_TEST_EXTENSION_TOKEN = original;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("离线签发工具不覆盖私钥，签发证书可由服务器验证", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-issuer-"));
  const run = promisify(execFile);
  try {
    const directory = join(root, "keys");
    await run(process.execPath, [
      "--import",
      "tsx",
      "scripts/license-tool.ts",
      "init",
      "--directory",
      directory,
      "--key-id",
      "test",
    ]);
    await expect(
      run(process.execPath, [
        "--import",
        "tsx",
        "scripts/license-tool.ts",
        "init",
        "--directory",
        directory,
        "--key-id",
        "test",
      ]),
    ).rejects.toThrow();
    const payload = licenseIssuer().issue({
      datasets: ["stations", "surface-hourly", "customer-data"],
    }).payload;
    await writeFile(join(root, "payload.json"), JSON.stringify(payload));
    await run(process.execPath, [
      "--import",
      "tsx",
      "scripts/license-tool.ts",
      "sign",
      "--payload",
      join(root, "payload.json"),
      "--private-key",
      join(directory, "issuer-private.pem"),
      "--output",
      join(root, "license.json"),
      "--key-id",
      "test",
    ]);
    const cert = JSON.parse(await readFile(join(root, "license.json"), "utf8")),
      roots = JSON.parse(
        await readFile(join(directory, "trust-roots.json"), "utf8"),
      );
    expect(JSON.stringify(roots)).not.toContain('"d":');
    const licensing = new TenantLicensing(
      new FileRepository(join(root, "store")),
      roots,
      true,
    );
    expect(
      (await licensing.import("alpha", 0, cert, "operator")).datasets,
    ).toContain("customer-data");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("独立后端模板校验Bearer和固定租户，使用受限服务账号读取原始来源", async () => {
  const core = createServer(async (req, res) => {
    if (req.url === "/api/auth/login") {
      for await (const _ of req) {
        void _;
      }
      res.setHeader("Set-Cookie", "dtv_session=test-session; HttpOnly");
      return res.end(JSON.stringify({ user: { tenantId: "alpha" } }));
    }
    expect(req.headers.cookie).toBe("dtv_session=test-session");
    res.end(
      JSON.stringify({
        source: "mock",
        observedAt: time,
        unit: "°C",
        crs: "EPSG:4326",
        observations: [],
      }),
    );
  });
  core.listen(0, "127.0.0.1");
  await once(core, "listening");
  const corePort = (core.address() as { port: number }).port;
  // 获取可用端口后交给独立进程，避免接触用户当前运行的服务。
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((r) => socket.close(() => r()));
  const token = "standalone-test-token-".repeat(3),
    child = spawn(
      process.execPath,
      ["extensions/backend-template/server.mjs"],
      {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          EXTENSION_ACCESS_TOKEN: token,
          EXTENSION_TENANT_ID: "alpha",
          CORE_API_USERNAME: "test-service",
          CORE_API_PASSWORD: "test-password",
          CORE_API_URL: `http://127.0.0.1:${corePort}`,
        },
        stdio: "ignore",
      },
    );
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(base + "/health")).ok) {
          ready = true;
          break;
        }
      } catch {
        /*等待启动*/
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(ready).toBe(true);
    const path =
      base + `/observations?${new URLSearchParams({ sceneId: "xian", time })}`;
    expect((await fetch(path)).status).toBe(403);
    expect(
      (
        await fetch(path, {
          headers: { Authorization: `Bearer ${token}`, "X-DTV-Tenant": "beta" },
        })
      ).status,
    ).toBe(403);
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${token}`, "X-DTV-Tenant": "alpha" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).source).toBe("mock");
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    core.closeAllConnections();
    await new Promise<void>((r) => core.close(() => r()));
  }
});
