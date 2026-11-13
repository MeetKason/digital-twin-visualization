/** 系统管理目录的真实权限组；重复的账号页面共用 accounts 权限。 */
export const SettingsSectionIds = [
  "accounts",
  "deployment",
  "scenarios",
  "licensing",
  "plugins",
  "publications",
  "audit",
  "stations",
  "models",
] as const;
export type SettingsSectionId = (typeof SettingsSectionIds)[number];

export const SettingsSectionNames: Record<SettingsSectionId, string> = {
  accounts: "账号与权限",
  deployment: "部署服务配置",
  scenarios: "场景包管理",
  licensing: "租户产品授权",
  plugins: "插件管理",
  publications: "发布管理",
  audit: "操作审计",
  stations: "站点数据",
  models: "模型管理",
};

/** 场景上限与账号授权相交；旧管理员账号兼容全量，普通账号缺省无管理授权。 */
export function effectiveSettingsSections(
  sceneSections: readonly SettingsSectionId[] | undefined,
  accountSections: readonly SettingsSectionId[] | undefined,
  role: "admin" | "editor" | "viewer",
  elevated: boolean,
): SettingsSectionId[] {
  if (elevated) return [...SettingsSectionIds];
  const scene = new Set(sceneSections ?? SettingsSectionIds);
  const account = new Set(accountSections ?? (role === "admin" ? SettingsSectionIds : []));
  return SettingsSectionIds.filter((id) => scene.has(id) && account.has(id));
}
