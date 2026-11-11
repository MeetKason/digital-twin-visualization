import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vitest";
test("离线包包含许可证公钥与扩展SDK模板，镜像操作可替换验证且不复制现场凭据", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-package-"));
  try {
    const docker = join(root, "docker"),
      output = join(root, "release");
    await writeFile(
      docker,
      '#!/usr/bin/env bash\nif [[ "$1" == "save" ]]; then\n while [[ "$#" -gt 0 ]]; do\n  if [[ "$1" == "-o" ]]; then printf "test fixture" > "$2"; exit 0; fi\n  shift\n done\nfi\nexit 0\n',
      { mode: 0o700 },
    );
    await promisify(execFile)(
      "bash",
      ["scripts/package-offline-release.sh", "0.3.0", output],
      { env: { ...process.env, PATH: root + ":" + process.env.PATH } },
    );
    expect(await readdir(join(output, "deploy/licensing"))).toEqual([
      "trust-roots.json",
    ]);
    expect(await readdir(join(output, "deploy/auth"))).toEqual([".gitkeep"]);
    expect(
      await readFile(
        join(output, "extensions/backend-template/server.mjs"),
        "utf8",
      ),
    ).toContain("EXTENSION_TENANT_ID");
    expect(
      await readFile(
        join(output, "sdk/packages/sdk/src/extensions.ts"),
        "utf8",
      ),
    ).toContain("ExtensionRegistry");
    expect(
      await readFile(join(output, "sdk/scripts/license-tool.ts"), "utf8"),
    ).toContain("签发私钥目录");
    expect(await readFile(join(output, "SHA256SUMS"), "utf8")).toContain(
      "./deploy/licensing/trust-roots.json",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
