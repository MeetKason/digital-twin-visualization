import { z } from "zod";
/** 模块和套餐是产品授权；角色与账号地区仍需单独校验。 */
export const ProductModules = [
  "map",
  "stations",
  "weather",
  "roam",
  "devices",
  "files",
  "plugins",
  "ingestion",
] as const;
export type ProductModule = (typeof ProductModules)[number];
export const ProductDatasets = [
  "stations",
  "surface-hourly",
  "radar-grid",
  "satellite-cloud",
  "wind-field",
  "humidity-field",
  "forecast-hourly",
  "grid-analysis",
  "warning-range",
  "environment-simulation",
] as const;
export type ProductDataset = (typeof ProductDatasets)[number];
export const ProductPlans = {
  basic: {
    name: "基础版",
    modules: ["map", "stations"] as readonly ProductModule[],
    datasets: ["stations", "surface-hourly"] as readonly string[],
  },
  professional: {
    name: "专业版",
    modules: [
      "map",
      "stations",
      "weather",
      "roam",
      "files",
      "ingestion",
    ] as readonly ProductModule[],
    datasets: ProductDatasets as readonly string[],
  },
  enterprise: {
    name: "完整扩展版",
    modules: ProductModules as readonly ProductModule[],
    datasets: ProductDatasets as readonly string[],
  },
};
export const LicensePayloadSchema = z
  .object({
    formatVersion: z.literal(1),
    licenseId: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
    tenantId: z.string().trim().min(1).max(64),
    customer: z.string().trim().min(1).max(100),
    project: z
      .object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(100),
      })
      .strict(),
    plan: z.enum(["basic", "professional", "enterprise"]),
    issuedAt: z.iso.datetime({ offset: true }),
    notBefore: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    modules: z.array(z.enum(ProductModules)).min(1).max(ProductModules.length),
    datasets: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
      .min(2)
      .max(64),
    regions: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
      .min(1)
      .max(50),
    maxAccounts: z.number().int().min(1).max(10000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const plan = ProductPlans[v.plan];
    if (
      !v.modules.includes("map") ||
      !v.datasets.includes("stations") ||
      !v.datasets.includes("surface-hourly") ||
      v.modules.some((m) => !plan.modules.includes(m)) ||
      (v.plan !== "enterprise" &&
        v.datasets.some((d) => !plan.datasets.includes(d)))
    )
      ctx.addIssue({
        code: "custom",
        message: "模块或数据集超出套餐，或缺少地图基础依赖",
      });
    if (
      [v.modules, v.datasets, v.regions].some(
        (a) => new Set(a).size !== a.length,
      ) ||
      Date.parse(v.notBefore) >= Date.parse(v.expiresAt) ||
      Date.parse(v.issuedAt) >= Date.parse(v.expiresAt)
    )
      ctx.addIssue({ code: "custom", message: "授权存在重复项或有效期无效" });
  });
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;
export const SignedLicenseSchema = z
  .object({
    keyId: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
    payload: LicensePayloadSchema,
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export type SignedLicense = z.infer<typeof SignedLicenseSchema>;
/** 先按契约归一化字段顺序，再签名；不能直接依赖导入JSON的键顺序。 */
export function licenseCanonical(keyId: string, payload: LicensePayload) {
  return JSON.stringify({
    keyId,
    payload: LicensePayloadSchema.parse(payload),
  });
}
export interface TenantEntitlement {
  revision: number;
  state:
    | "active"
    | "development"
    | "demo"
    | "missing"
    | "invalid"
    | "expired"
    | "not-yet-valid"
    | "revoked";
  tenantId: string;
  modules: ProductModule[];
  datasets: string[];
  regions: string[] | null;
  maxAccounts: number;
  license?: LicensePayload;
}
export const moduleForMenu: Record<string, ProductModule | undefined> = {
  home: "map",
  station: "stations",
  weather: "weather",
  roam: "roam",
  device: "devices",
};
