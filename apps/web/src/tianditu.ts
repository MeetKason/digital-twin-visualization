import {
  Credit,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
  type ImageryProvider,
} from "cesium";

const subdomains = ["0", "1", "2", "3", "4", "5", "6", "7"];

/** 固定创建天地图卫星影像 Provider，并保留天地图署名。 */
export function createTiandituProvider(key: string): ImageryProvider {
  const url =
    "https://t{s}.tianditu.gov.cn/img_w/wmts" +
    "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img" +
    `&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&tk=${encodeURIComponent(key)}` +
    "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
  return new UrlTemplateImageryProvider({
    url,
    subdomains,
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 18,
    credit: new Credit("天地图", true),
  });
}
