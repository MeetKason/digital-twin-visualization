import { z } from "zod";

const position = z.array(z.number().finite()).min(2).refine(
  (p) => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90,
  "边界坐标必须是经纬度",
);
const ring = z.array(position).min(4).refine(
  (points) => points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1],
  "边界环必须闭合",
);
const polygon = z.array(ring).min(1);
const geometry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygon }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1) }),
]);
const collection = z.object({
  type: z.literal("FeatureCollection"),
  crs: z.object({ properties: z.object({ name: z.string() }) }).optional(),
  features: z.array(z.object({
    type: z.literal("Feature"),
    properties: z.object({ name: z.string().optional() }).nullable(),
    geometry,
  })).min(1),
});

/** 校验区划坐标和闭合环；保留多面及内环，不用包围矩形替代真实行政边界。 */
export function parseAdministrativeBoundary(data: unknown) {
  const parsed = collection.parse(data);
  if (parsed.crs && !/CRS84|EPSG(?::|::)4326$/i.test(parsed.crs.properties.name)) {
    throw new Error("行政边界只支持CRS84或EPSG:4326经纬度坐标");
  }
  return parsed.features.flatMap((feature) => {
    const polygons = feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.flatMap((rings) => rings.map((points) => ({
      name: feature.properties?.name ?? "行政边界",
      coordinates: points.flatMap((point) => [point[0], point[1]]),
    })));
  });
}
