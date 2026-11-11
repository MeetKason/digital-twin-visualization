import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  LicensePayloadSchema,
  licenseCanonical,
  type SignedLicense,
} from "@dtv/contracts";
import { TenantLicensing } from "../apps/core-api/src/platform/licensing";
import { FileRepository } from "../apps/core-api/src/platform/repository";
const pair = generateKeyPairSync("ed25519");
const roots = { issuer: pair.publicKey.export({ format: "jwk" }) };
function issued(tenantId = "alpha", sequence = 1): SignedLicense {
  const payload = LicensePayloadSchema.parse({
    formatVersion: 1,
    licenseId: `license-${sequence}`,
    tenantId,
    customer: "演示客户",
    project: { id: "project-a", name: "演示项目" },
    plan: "basic",
    issuedAt: new Date(Date.now() - 10000 + sequence).toISOString(),
    notBefore: new Date(Date.now() - 20000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    modules: ["map", "stations"],
    datasets: ["stations", "surface-hourly"],
    regions: ["xian"],
    maxAccounts: 3,
  });
  return {
    keyId: "issuer",
    payload,
    signature: sign(
      null,
      Buffer.from(licenseCanonical("issuer", payload)),
      pair.privateKey,
    ).toString("base64"),
  };
}
test("许可证验签、租户隔离、有效期、套餐上限及开发模式明确区分", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-license-"));
  try {
    const repo = new FileRepository(root),
      licensing = new TenantLicensing(repo, roots, true);
    expect((await licensing.status("alpha")).state).toBe("missing");
    await expect(licensing.require("alpha", "xian", "map")).rejects.toThrow();
    const cert = issued();
    await expect(
      licensing.import(
        "alpha",
        0,
        { ...cert, payload: { ...cert.payload, customer: "被篡改的客户" } },
        "operator",
      ),
    ).rejects.toThrow("签名");
    await expect(
      licensing.import("beta", 0, cert, "operator"),
    ).rejects.toThrow();
    await expect(
      licensing.import(
        "alpha",
        0,
        { ...cert, payload: { ...cert.payload, modules: ["map", "devices"] } },
        "operator",
      ),
    ).rejects.toThrow();
    await licensing.import("alpha", 0, cert, "operator");
    await licensing.require("alpha", "xian", "stations", "stations");
    await expect(
      licensing.require("alpha", "taiyuan", "map"),
    ).rejects.toThrow();
    await expect(
      licensing.require("alpha", "xian", "devices"),
    ).rejects.toThrow();
    await expect(
      licensing.require("alpha", "xian", "weather", "radar-mock"),
    ).rejects.toThrow();
    expect((await licensing.status("beta")).state).toBe("missing");
    const future = new TenantLicensing(
      repo,
      roots,
      true,
      () => Date.now() + 7200000,
    );
    expect((await future.status("alpha")).state).toBe("expired");
    expect(
      (
        await new TenantLicensing(
          repo,
          roots,
          true,
          () => Date.now() - 86400000,
        ).status("alpha")
      ).state,
    ).toBe("not-yet-valid");
    expect(
      (await new TenantLicensing(repo, {}, false).status("fresh")).state,
    ).toBe("development");
    expect(
      (await new TenantLicensing(repo, {}, false).status("alpha")).state,
    ).toBe("invalid");
    expect(
      LicensePayloadSchema.safeParse({
        ...cert.payload,
        modules: ["map", "devices"],
      }).success,
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("许可证吊销不能由重放撤销，续签需新证且CAS防覆盖，审计同租户保存", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-license-"));
  try {
    const repo = new FileRepository(root),
      licensing = new TenantLicensing(repo, roots, true);
    const cert = issued();
    await licensing.import("alpha", 0, cert, "operator");
    await licensing.revoke("alpha", 1, "operator");
    expect((await licensing.status("alpha")).state).toBe("revoked");
    await expect(
      licensing.import("alpha", 2, cert, "operator"),
    ).rejects.toThrow();
    await expect(
      licensing.import("alpha", 1, issued("alpha", 2), "operator"),
    ).rejects.toThrow();
    await licensing.import("alpha", 2, issued("alpha", 2), "operator");
    expect((await licensing.status("alpha")).state).toBe("active");
    const audit = await repo.audit("alpha");
    expect(audit.filter((entry) => entry.result === "success")).toHaveLength(3);
    expect(audit.filter((entry) => entry.result === "rejected")).toHaveLength(
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Worker不能仅凭演示租户前缀获得授权，演示关闭或会话到期后失效", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtv-demo-license-"));
  try {
    const repo = new FileRepository(root),
      licensing = new TenantLicensing(repo, {}, true),
      tenant = "demo-00000000-0000-0000-0000-000000000000";
    await expect(
      licensing.requireTask(tenant, "xian", "surface-hourly", true),
    ).rejects.toThrow();
    await repo.saveConfiguration(
      tenant,
      "demo-session-grant",
      0,
      { expiresAt: Date.now() + 1000 },
      "demo",
      "auth.demo-grant",
    );
    await licensing.requireTask(tenant, "xian", "surface-hourly", true);
    await expect(
      licensing.requireTask(tenant, "xian", "surface-hourly", false),
    ).rejects.toThrow();
    await expect(
      new TenantLicensing(repo, {}, true, () => Date.now() + 2000).requireTask(
        tenant,
        "xian",
        "surface-hourly",
        true,
      ),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
