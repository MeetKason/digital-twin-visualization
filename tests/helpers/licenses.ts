import { generateKeyPairSync, sign } from "node:crypto";
import {
  LicensePayloadSchema,
  licenseCanonical,
  ProductModules,
  ProductDatasets,
  type LicensePayload,
  type SignedLicense,
} from "@dtv/contracts";
export function licenseIssuer() {
  const pair = generateKeyPairSync("ed25519");
  let count = 0;
  return {
    roots: { test: pair.publicKey.export({ format: "jwk" }) },
    issue(overrides: Partial<LicensePayload> = {}): SignedLicense {
      const payload = LicensePayloadSchema.parse({
        formatVersion: 1,
        licenseId: `test-${++count}`,
        tenantId: "alpha",
        customer: "测试客户",
        project: { id: "project", name: "测试项目" },
        plan: "enterprise",
        issuedAt: new Date(Date.now() - 100000 + count).toISOString(),
        notBefore: new Date(Date.now() - 200000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        modules: [...ProductModules],
        datasets: [...ProductDatasets],
        regions: ["xian", "taiyuan"],
        maxAccounts: 10,
        ...overrides,
      });
      return {
        keyId: "test",
        payload,
        signature: sign(
          null,
          Buffer.from(licenseCanonical("test", payload)),
          pair.privateKey,
        ).toString("base64"),
      };
    },
  };
}
