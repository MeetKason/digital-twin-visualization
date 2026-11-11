import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { readFileSync } from "node:fs";
import {
  SignedLicenseSchema,
  ProductModules,
  ProductDatasets,
  licenseCanonical,
  type ProductModule,
  type SignedLicense,
  type TenantEntitlement,
} from "@dtv/contracts";
import type { Repository } from "./repository";
interface LicenseRecord {
  certificate: SignedLicense;
  revoked: boolean;
}
export function loadLicenseRoots(): Record<string, JsonWebKey> {
  if (!process.env.LICENSE_TRUST_ROOTS_FILE) return {};
  const value = JSON.parse(
    readFileSync(process.env.LICENSE_TRUST_ROOTS_FILE, "utf8"),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("许可证信任根格式错误");
  for (const key of Object.values(value)) {
    if (
      (key as JsonWebKey).kty !== "OKP" ||
      (key as JsonWebKey).crv !== "Ed25519" ||
      "d" in (key as object)
    )
      throw new Error("许可证信任根只接收Ed25519公钥");
    createPublicKey({ key: key as JsonWebKey, format: "jwk" });
  }
  return value;
}
/** API与Worker共用授权判定，每次从配置仓库读取，吊销和续期不依赖进程重启。 */
export class TenantLicensing {
  constructor(
    private repo: Repository,
    private roots: Record<string, JsonWebKey>,
    private required: boolean,
    private now: () => number = Date.now,
  ) {}
  private verify(raw: unknown): SignedLicense {
    const parsed = SignedLicenseSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException("许可证格式、套餐或依赖无效");
    const cert = parsed.data,
      root = this.roots[cert.keyId];
    try {
      if (
        !root ||
        root.d ||
        !verify(
          null,
          Buffer.from(licenseCanonical(cert.keyId, cert.payload)),
          createPublicKey({ key: root, format: "jwk" }),
          Buffer.from(cert.signature, "base64"),
        )
      )
        throw new Error();
    } catch {
      throw new BadRequestException("许可证签名无效或发行者不受信任");
    }
    return cert;
  }
  async status(tenantId: string, demo = false): Promise<TenantEntitlement> {
    const record = await this.repo.readConfiguration(
      tenantId,
      "product-license",
    );
    const empty: TenantEntitlement = {
      revision: record?.revision ?? 0,
      tenantId,
      state: "missing",
      modules: [],
      datasets: [],
      regions: [],
      maxAccounts: 0,
    };
    if (demo || (!record && !this.required))
      return {
        ...empty,
        state: demo ? "demo" : "development",
        modules: [...ProductModules],
        datasets: [...ProductDatasets],
        regions: null,
        maxAccounts: 10000,
      };
    if (!record) return empty;
    try {
      const data = record.data as LicenseRecord,
        cert = this.verify(data.certificate),
        license = cert.payload;
      if (license.tenantId !== tenantId || typeof data.revoked !== "boolean")
        return { ...empty, state: "invalid" };
      const state = data.revoked
        ? "revoked"
        : this.now() < Date.parse(license.notBefore)
          ? "not-yet-valid"
          : this.now() >= Date.parse(license.expiresAt)
            ? "expired"
            : "active";
      return {
        ...empty,
        license,
        state,
        ...(state === "active"
          ? {
              modules: license.modules,
              datasets: license.datasets,
              regions: license.regions,
              maxAccounts: license.maxAccounts,
            }
          : {}),
      };
    } catch {
      return { ...empty, state: "invalid" };
    }
  }
  async require(
    tenant: string,
    scene: string,
    module: ProductModule,
    dataset?: string,
    demo = false,
  ) {
    const result = await this.status(tenant, demo);
    if (
      !result.modules.includes(module) ||
      (result.regions && !result.regions.includes(scene)) ||
      (dataset && !result.datasets.includes(dataset))
    ) {
      throw new ForbiddenException(
        "产品授权不允许该模块、数据集或地区，请联系平台管理员",
      );
    }
    return result;
  }
  /** Worker只信任服务端签发的演示标记，不能凭租户名称前缀绕过许可证。 */
  async requireTask(
    tenant: string,
    scene: string,
    product: string,
    allowDemo: boolean,
  ) {
    const marker = allowDemo
      ? await this.repo.readConfiguration(tenant, "demo-session-grant")
      : null;
    const grant = marker?.data as { expiresAt?: unknown } | undefined;
    const demo =
      allowDemo &&
      /^demo-[0-9a-f-]{36}$/.test(tenant) &&
      typeof grant?.expiresAt === "number" &&
      grant.expiresAt > this.now();
    return this.require(tenant, scene, "ingestion", product, demo);
  }
  /** 拒绝请求也写入审计，只记录主体和结果，不保存失败证书或密钥内容。 */
  private async audited<T>(
    tenant: string,
    actor: string,
    action: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      await this.repo
        .logAudit({
          tenantId: tenant,
          actor,
          sceneId: "",
          action,
          result: "rejected",
        })
        .catch(() => {});
      throw error;
    }
  }
  async import(tenant: string, expected: number, raw: unknown, actor: string) {
    return this.audited(tenant, actor, "license.import", () =>
      this.importValidated(tenant, expected, raw, actor),
    );
  }
  private async importValidated(
    tenant: string,
    expected: number,
    raw: unknown,
    actor: string,
  ) {
    if (Buffer.byteLength(JSON.stringify(raw) ?? "") > 32768)
      throw new BadRequestException("许可证不能超过32KB");
    const certificate = this.verify(raw);
    if (certificate.payload.tenantId !== tenant)
      throw new BadRequestException("许可证租户与目标不一致");
    if (
      Date.parse(certificate.payload.expiresAt) <= this.now() ||
      Date.parse(certificate.payload.issuedAt) > this.now()
    )
      throw new BadRequestException("许可证已过期或签发时间在未来");
    const current = await this.repo.readConfiguration(
      tenant,
      "product-license",
    );
    if ((current?.revision ?? 0) !== expected)
      throw new ConflictException("授权修订冲突，请刷新");
    if (current) {
      const previous = (current.data as LicenseRecord).certificate?.payload;
      if (
        previous &&
        (previous.licenseId === certificate.payload.licenseId ||
          Date.parse(previous.issuedAt) >=
            Date.parse(certificate.payload.issuedAt))
      )
        throw new ConflictException("续期必须使用新证且签发时间晚于已有许可证");
    }
    await this.repo.saveConfiguration(
      tenant,
      "product-license",
      expected,
      { certificate, revoked: false },
      actor,
      "license.import",
    );
    return this.status(tenant);
  }
  async revoke(tenant: string, expected: number, actor: string) {
    return this.audited(tenant, actor, "license.revoke", () =>
      this.revokeValidated(tenant, expected, actor),
    );
  }
  private async revokeValidated(
    tenant: string,
    expected: number,
    actor: string,
  ) {
    const current = await this.repo.readConfiguration(
      tenant,
      "product-license",
    );
    if (!current || current.revision !== expected)
      throw new ConflictException("授权修订冲突，请刷新");
    await this.repo.saveConfiguration(
      tenant,
      "product-license",
      expected,
      { ...(current.data as LicenseRecord), revoked: true },
      actor,
      "license.revoke",
    );
    return this.status(tenant);
  }
}
