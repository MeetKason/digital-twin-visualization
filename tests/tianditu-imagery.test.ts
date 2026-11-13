import { ImageryProvider, GeographicTilingScheme } from "cesium";
import { expect, test } from "vitest";
import { createTiandituProvider, tiandituGeographicMatrixLevel } from "../apps/web/src/tianditu";

test("经纬度影像与地形共用 2×1 地理网格，并跳过会画坏颜色的墨卡托重投影", () => {
  expect(tiandituGeographicMatrixLevel(0)).toBe(1);
  expect(tiandituGeographicMatrixLevel(17)).toBe(18);
  const provider = createTiandituProvider("demo-key");
  expect(provider.tilingScheme).toBeInstanceOf(GeographicTilingScheme);
  expect(provider.tilingScheme.getNumberOfXTilesAtLevel(0)).toBe(2);
  expect(provider.tilingScheme.getNumberOfYTilesAtLevel(0)).toBe(1);
  expect(provider.maximumLevel).toBe(17);

  const requested: string[] = [];
  const loadImage = ImageryProvider.loadImage;
  ImageryProvider.loadImage = ((_provider: ImageryProvider, resource: { url?: string } | string) => {
    requested.push(typeof resource === "string" ? resource : (resource.url ?? ""));
    return Promise.resolve(undefined);
  }) as unknown as typeof ImageryProvider.loadImage;
  try {
    provider.requestImage(3, 1, 4);
  } finally {
    ImageryProvider.loadImage = loadImage;
  }
  expect(requested).toHaveLength(1);
  const url = new URL(requested[0]);
  expect(url.pathname).toBe("/img_c/wmts");
  expect(url.searchParams.get("TILEMATRIXSET")).toBe("c");
  expect(url.searchParams.get("TILEMATRIX")).toBe("5");
  expect(url.searchParams.get("TILECOL")).toBe("3");
  expect(url.searchParams.get("TILEROW")).toBe("1");
  expect(url.searchParams.get("tk")).toBe("demo-key");
});
