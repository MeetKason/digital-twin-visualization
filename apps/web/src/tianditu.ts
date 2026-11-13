import {
  Credit,
  GeographicTilingScheme,
  UrlTemplateImageryProvider,
  type ImageryProvider,
} from "cesium";

const subdomains = ["0", "1", "2", "3", "4", "5", "6", "7"];

/**
 * Cesium 地理网格 0 级是全球 2×1，对应天地图经纬度矩阵第 1 级。
 * 矩阵最高到 18，因此 Cesium 级别停在 17。
 */
export function tiandituGeographicMatrixLevel(cesiumLevel: number): number {
  return cesiumLevel + 1;
}

/**
 * 创建与地形同一套经纬度网格的天地图卫星影像。
 * Web 墨卡托影像贴到地理地形时，Cesium 会重投影 11 级及更粗的瓦片；这次 GPU 重投影会把山体画成紫红条纹。
 */
export function createTiandituProvider(key: string): ImageryProvider {
  const url =
    "https://t{s}.tianditu.gov.cn/img_c/wmts" +
    "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img" +
    "&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles" +
    `&tk=${encodeURIComponent(key)}` +
    "&TILEMATRIX={tdtMatrix}&TILEROW={y}&TILECOL={x}";
  return new UrlTemplateImageryProvider({
    url,
    subdomains,
    tilingScheme: new GeographicTilingScheme(),
    maximumLevel: 17,
    credit: new Credit("天地图", true),
    customTags: {
      tdtMatrix: (_provider: ImageryProvider, _x: number, _y: number, level: number) =>
        tiandituGeographicMatrixLevel(level),
    },
  });
}
