import { it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { hashPassword } from "../apps/core-api/src/platform/auth";
it("真实 HTTP：跨租户隔离、角色拒写、CSRF、并发修订、服务重启和注销", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-http-"));
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let logs = "";
  const accounts = [
    {
      id: "alpha-admin",
      tenantId: "alpha",
      role: "admin",
      scenes: ["xian", "taiyuan"],
      passwordHash: hashPassword("alpha-secret"),
    },
    {
      id: "alpha-reader",
      tenantId: "alpha",
      role: "viewer",
      scenes: ["xian"],
      passwordHash: hashPassword("reader-secret"),
    },
    {
      id: "beta-admin",
      tenantId: "beta",
      role: "admin",
      scenes: ["xian"],
      passwordHash: hashPassword("beta-secret"),
    },
  ];
  accounts.push({
    id: "alpha-editor",
    tenantId: "alpha",
    role: "editor",
    scenes: ["xian"],
    passwordHash: hashPassword("editor-secret"),
  });
  await writeFile(join(dir, "users.json"), JSON.stringify(accounts));
  async function start() {
    child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/core-api/src/main.ts"],
      {
        env: {
          ...process.env,
          PORT: String(port),
          DATA_DIR: dir,
          AUTH_USERS_FILE: join(dir, "users.json"),
          DEMO_ENABLED: "false",
          DATABASE_URL: "",
          PGHOST: "",
          TRUST_PROXY_HOPS: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (b) => (logs += b));
    child.stderr?.on("data", (b) => (logs += b));
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) return;
      } catch {
        /* waiting for child */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(logs);
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      await ended;
    }
  }
  const call = (
    path: string,
    cookie = "",
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(base + "/api" + path, {
      method,
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
        "X-DTV-Request": "1",
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  async function login(username: string, password: string) {
    const r = await call("/auth/login", "", "POST", { username, password });
    expect(r.status).toBe(201);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    return {
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      user: (await r.json()).user,
    };
  }
  try {
    await start();
    expect((await call("/scenes")).status).toBe(401);
    expect((await call("/auth/demo", "", "POST")).status).toBe(403);
    const a = await login("alpha-admin", "alpha-secret"),
      b = await login("beta-admin", "beta-secret"),
      v = await login("alpha-reader", "reader-secret");
    const original = await (
      await call("/scenes/xian/business", a.cookie)
    ).json();
    original.data.stations[0].name = "Alpha private";
    const saved = await call(
      "/scenes/xian/business",
      a.cookie,
      "PUT",
      original,
    );
    expect(saved.status).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody.revision).toBe(1);
    expect(savedBody.owner).toEqual({ id: a.user.id, tenantId: "alpha" });
    expect(
      (await call("/scenes/xian/business", a.cookie, "PUT", original)).status,
    ).toBe(409);
    expect(
      (
        await call("/scenes/xian/business", v.cookie, "PUT", {
          ...original,
          owner: { id: v.user.id, tenantId: "alpha" },
        })
      ).status,
    ).toBe(403);
    expect((await call("/scenes/chengdu/business", a.cookie)).status).toBe(403);
    const beta = await (
      await call("/scenes/xian/business?tenantId=alpha", b.cookie)
    ).json();
    expect(beta.data.stations[0].name).not.toBe("Alpha private");
    expect(
      (await call("/scenes/xian/business", b.cookie, "PUT", original)).status,
    ).toBe(403);
    expect(
      (
        await call("/scenes/xian/business", a.cookie, "PUT", original, {
          Origin: "https://foreign.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/scenes/xian/business", a.cookie, "PUT", original, {
          "X-DTV-Request": "",
        })
      ).status,
    ).toBe(403);
    const editor = await login("alpha-editor", "editor-secret");
    const editState = await (
      await call("/scenes/xian/business", editor.cookie)
    ).json();
    editState.data.stations[0].name = "Alpha editor";
    expect(
      (await call("/scenes/xian/business", editor.cookie, "PUT", editState))
        .status,
    ).toBe(200);
    editState.revision = 2;
    editState.data.users[0].name = "unauthorized user edit";
    expect(
      (await call("/scenes/xian/business", editor.cookie, "PUT", editState))
        .status,
    ).toBe(403);
    const filePath = "/scenes/xian/files";
    const pdf = "%PDF-1.7\nshared tenant attachment";
    const upload = (
      cookie: string,
      name = "站点资料.pdf",
      content = pdf,
      extra = {},
    ) =>
      fetch(base + "/api" + filePath, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-DTV-Request": "1",
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(name),
          ...extra,
        },
        body: content,
      });
    expect((await upload("")).status).toBe(401);
    expect((await upload(v.cookie)).status).toBe(403);
    expect(
      (
        await upload(a.cookie, "a.pdf", pdf, {
          Origin: "https://foreign.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await upload(a.cookie, "a.html", "<script>bad</script>")).status,
    ).toBe(400);
    expect((await upload(a.cookie, "fake.pdf", "not a PDF")).status).toBe(400);
    expect(
      (
        await upload(
          a.cookie,
          "external.gltf",
          JSON.stringify({
            asset: { version: "2.0" },
            buffers: [{ uri: "https://outside.test/a.bin" }],
          }),
        )
      ).status,
    ).toBe(400);
    let chunks = 101;
    const tooLarge = await fetch(base + "/api" + filePath, {
      method: "POST",
      headers: {
        Cookie: a.cookie,
        "X-DTV-Request": "1",
        "Content-Type": "application/octet-stream",
        "X-File-Name": "large.pdf",
      },
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
          if (--chunks === 0) controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(tooLarge.status).toBe(413);
    const aborted = httpRequest(base + "/api" + filePath, {
      method: "POST",
      headers: {
        Cookie: a.cookie,
        "X-DTV-Request": "1",
        "Content-Type": "application/octet-stream",
        "X-File-Name": "abort.pdf",
      },
    });
    aborted.on("error", () => {});
    aborted.write("%PDF-1.7 unfinished");
    // Wait until the server has created the staging directory before disconnecting.
    let staged = false;
    for (let i = 0; i < 100; i++) {
      staged = (await readdir(dir, { recursive: true })).some((p) =>
        p.includes(".upload-"),
      );
      if (staged) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    aborted.destroy();
    expect(staged).toBe(true);
    for (let i = 0; i < 100; i++) {
      if (
        !(await readdir(dir, { recursive: true })).some((p) =>
          p.includes(".upload-"),
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(
      (await readdir(dir, { recursive: true })).some((p) =>
        p.includes(".upload-"),
      ),
    ).toBe(false);
    const uploaded = await upload(a.cookie);
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json();
    expect(file.id).toMatch(/^srv_[a-f0-9-]{36}$/);
    const downloadPath = filePath + "/" + file.id;
    const inventory = await call(filePath, a.cookie);
    expect(inventory.status).toBe(200);
    expect(
      (await inventory.json()).find((f: { id: string }) => f.id === file.id)
        .referenced,
    ).toBe(false);
    expect(await (await call(filePath, b.cookie)).json()).toEqual([]);

    const shared = await call(downloadPath, v.cookie);
    expect(shared.status).toBe(200);
    expect(shared.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await shared.text()).toBe(pdf);
    expect((await call(downloadPath, b.cookie)).status).toBe(404);
    expect(
      (await call(downloadPath.replace("xian", "taiyuan"), a.cookie)).status,
    ).toBe(404);
    expect((await call(downloadPath, v.cookie, "DELETE")).status).toBe(403);
    const withFile = await (
      await call("/scenes/xian/business", a.cookie)
    ).json();
    withFile.data.assets.push({
      id: "shared-pdf",
      name: "共享文档",
      kind: "document",
      blobId: file.id,
      fileName: "站点资料.pdf",
      size: Buffer.byteLength(pdf),
    });
    expect(
      (await call("/scenes/xian/business", a.cookie, "PUT", withFile)).status,
    ).toBe(200);
    expect((await call(downloadPath, a.cookie, "DELETE")).status).toBe(409);
    const mismatched = await (
      await call("/scenes/xian/business", a.cookie)
    ).json();
    mismatched.data.assets[0].size += 1;
    expect(
      (await call("/scenes/xian/business", a.cookie, "PUT", mismatched)).status,
    ).toBe(400);
    const foreignRef = await (
      await call("/scenes/xian/business", b.cookie)
    ).json();
    foreignRef.data.assets = withFile.data.assets;
    expect(
      (await call("/scenes/xian/business", b.cookie, "PUT", foreignRef)).status,
    ).toBe(400);
    const audits = await (await call("/audit", a.cookie)).json();
    expect(
      audits.some(
        (e: { action: string; result: string }) =>
          e.action === "business.write" && e.result === "success",
      ),
    ).toBe(true);
    expect(
      audits.every((e: { tenantId: string }) => e.tenantId === "alpha"),
    ).toBe(true);
    await stop();
    await start();
    expect(
      (await (await call("/scenes/xian/business", a.cookie)).json()).data
        .stations[0].name,
    ).toBe("Alpha editor");
    expect(await (await call(downloadPath, v.cookie)).text()).toBe(pdf);
    const unlink = await (await call("/scenes/xian/business", a.cookie)).json();
    unlink.data.assets = [];
    expect(
      (await call("/scenes/xian/business", a.cookie, "PUT", unlink)).status,
    ).toBe(200);
    expect((await call(downloadPath, a.cookie, "DELETE")).status).toBe(200);
    expect((await call(downloadPath, a.cookie)).status).toBe(404);
    await call("/auth/logout", a.cookie, "POST");
    expect((await call("/scenes", a.cookie)).status).toBe(401);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await call(
            "/auth/login",
            "",
            "POST",
            { username: "alpha-admin", password: "wrong" },
            { "X-Forwarded-For": "10.0.0.1" },
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await call(
          "/auth/login",
          "",
          "POST",
          { username: "alpha-admin", password: "alpha-secret" },
          { "X-Forwarded-For": "10.0.0.1" },
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await call(
          "/auth/login",
          "",
          "POST",
          { username: "beta-admin", password: "beta-secret" },
          { "X-Forwarded-For": "10.0.0.1" },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          "/auth/login",
          "",
          "POST",
          { username: "alpha-admin", password: "alpha-secret" },
          { "X-Forwarded-For": "10.0.0.2" },
        )
      ).status,
    ).toBe(201);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
