import { z } from "zod";
export const SceneSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(80),
  shortName: z.string().trim().min(1).max(20),
  regionCode: z.string().max(32),
  center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  height: z.number().positive().max(10000000),
  /** 同源行政边界静态资源；未配置地区继续显示明确标记的示例边框。 */
  boundaryUrl: z
    .string()
    .regex(/^\/geojson\/[a-zA-Z0-9_-]+\.geojson$/)
    .optional(),
  modules: z.array(z.string().max(64)).max(64),
  revision: z.string().trim().min(1).max(64),
  source: z.literal("mock"),
  enabledLayers: z.array(z.string().max(64)).max(64).optional(),
  ui: z
    .object({
      menus: z
        .array(
          z.enum(["home", "roam", "station", "weather", "device", "settings"]),
        )
        .min(2)
        .max(6),
      theme: z
        .object({
          primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          navy: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        })
        .strict(),
      layout: z
        .object({
          panelWidth: z.number().int().min(240).max(400),
          timelineHeight: z.number().int().min(96).max(160),
        })
        .strict(),
    })
    .strict()
    .optional(),
});
export type SceneConfig = z.infer<typeof SceneSchema>;
