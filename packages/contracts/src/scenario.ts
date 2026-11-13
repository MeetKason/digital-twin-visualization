import { z } from "zod";
import { LAYERS } from "./index";
import { SceneSchema } from "./scene";
export const MenuIds = [
  "home",
  "roam",
  "station",
  "weather",
  "device",
  "settings",
] as const;
export type MenuId = (typeof MenuIds)[number];

/** 场景包只携带声明式配置，不接收可执行代码、凭据和外部资源地址。 */
export const ScenarioPackSchema = z
  .object({
    formatVersion: z.literal(1),
    coreApi: z.literal(1),
    description: z.string().max(1000).default(""),
    scene: SceneSchema.strict(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const menus = pack.scene.ui?.menus;
    const settingsSections = pack.scene.ui?.settingsSections;
    if (settingsSections && new Set(settingsSections).size !== settingsSections.length)
      ctx.addIssue({ code: "custom", path: ["scene", "ui", "settingsSections"], message: "系统管理子菜单不能重复" });
    // 导航和主色承载白色文字，拒绝几乎不可读的浅色组合。
    for (const [field, color] of Object.entries(pack.scene.ui?.theme ?? {})) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) continue;
      const channels = [1, 3, 5]
        .map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
      const contrast =
        1.05 /
        (channels[0] * 0.2126 +
          channels[1] * 0.7152 +
          channels[2] * 0.0722 +
          0.05);
      if (contrast < 3)
        ctx.addIssue({
          code: "custom",
          path: ["scene", "ui", "theme", field],
          message: "请选择与白色文字对比充足的深色主题",
        });
    }
    if (
      menus &&
      (!menus.includes("home") ||
        !menus.includes("settings") ||
        new Set(menus).size !== menus.length)
    )
      ctx.addIssue({
        code: "custom",
        path: ["scene", "ui", "menus"],
        message: "菜单不能重复，且必须保留总览和系统管理",
      });
    const layers = pack.scene.enabledLayers;
    if (
      layers &&
      (!menus || menus.includes("weather")) &&
      !layers.includes("rainfall")
    )
      ctx.addIssue({
        code: "custom",
        path: ["scene", "enabledLayers"],
        message: "气象专题启用时必须保留降水图层依赖",
      });
    if (
      layers &&
      (new Set(layers).size !== layers.length ||
        layers.some((id) => !LAYERS.some((layer) => layer.id === id)) ||
        ["boundary", "stations", "temperature"].some(
          (id) => !layers.includes(id),
        ))
    )
      ctx.addIssue({
        code: "custom",
        path: ["scene", "enabledLayers"],
        message: "图层须来自目录且不能重复，必须保留边界、站点和温度时次依赖",
      });
  });
export type ScenarioPack = z.infer<typeof ScenarioPackSchema>;
export const ScenarioDocumentSchema = z.object({
  draft: ScenarioPackSchema.nullable(),
  published: ScenarioPackSchema.nullable(),
  history: z
    .array(
      z.object({
        revision: z.number().int().positive(),
        pack: ScenarioPackSchema,
        actor: z.string(),
        at: z.string(),
      }),
    )
    .max(20),
});
export type ScenarioDocument = z.infer<typeof ScenarioDocumentSchema>;
export interface ScenarioRevision {
  revision: number;
  data: ScenarioDocument;
}
