import {
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
  type ImageryProvider,
} from "cesium";

/** 天地图浏览器端 WMTS 图层代码。 */
export type TiandituLayer = "vec_w" | "cva_w" | "img_w" | "cia_w" | "ter_w";

export type BasemapType = "img" | "vec" | "ter";

const subdomains = ["0", "1", "2", "3", "4", "5", "6", "7"];
const layerByType: Record<BasemapType, TiandituLayer> = {
  img: "img_w",
  vec: "vec_w",
  ter: "ter_w",
};

/** 把用户选择转换为 WMTS 图层代码。 */
export function tiandituLayer(type: BasemapType): TiandituLayer {
  return layerByType[type];
}

/** 为 WMTS 图层创建 EPSG:3857 瓦片 Provider，并保留天地图署名。 */
export function createTiandituProvider(layer: TiandituLayer, key: string): ImageryProvider {
  const layerName = layer.slice(0, -2);
  const url =
    `https://t{s}.tianditu.gov.cn/${layer}/wmts` +
    `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layerName}` +
    `&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&tk=${encodeURIComponent(key)}` +
    "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
  return new UrlTemplateImageryProvider({
    url,
    subdomains,
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 18,
    credit: "天地图",
  });
}

/** 底图选择器显示的选项及其短标签。 */
export const BASEMAP_OPTIONS: { key: BasemapType; label: string }[] = [
  { key: "vec", label: "矢量图" },
  { key: "img", label: "卫星图" },
  { key: "ter", label: "地形图" },
];

/** 初次打开地图时使用影像底图。 */
export const DEFAULT_BASEMAP: BasemapType = "img";
