/** 站点类型到彩色 Symbol 名称的映射，图案颜色由 iconfont 项目原始 SVG 决定。 */
const stationIcons: Record<string, string> = {
  GNSS: "GNSS",
  区域自动站: "quyuzidongzhan",
  土壤水分: "turangshuifen",
  土壤水分站: "turangshuifen",
  烟炉: "yanlu",
  国家无人站: "guojiawurenzhan",
  高空观测站: "gaokongguancezhan",
  温室气体: "wenshiqiti",
  物候: "wuhou",
  "高炮、火箭": "a-gaopaohuojian",
  国家有人站: "guojiayourenzhan",
  火箭: "huojian",
  人影火箭点: "huojian",
  国家气象站: "guojiaqixiangzhan",
  雷达: "leida",
  雷达站: "leida",
  高炮: "gaopao",
  人影高炮点: "gaopao",
  闪电定位仪: "shandiandingweiyi",
  国家基本站: "guojiajibenzhan",
  国家基准站: "guojiajizhunzhan",
};

const markerCache = new Map<string, Promise<HTMLImageElement>>();

/** 从已加载的 SVG Symbol 雪碧图中提取彩色图案，转换成 Cesium Billboard 可用图像。 */
export function createStationMarker(type: string): Promise<HTMLImageElement> {
  const symbolName = stationIcons[type] ?? stationIcons["国家有人站"];
  const cached = markerCache.get(symbolName);
  if (cached) return cached;

  const marker = (async () => {
    const symbol = document.getElementById(`icon-${symbolName}`);
    if (!(symbol instanceof SVGSymbolElement)) {
      throw new Error(`站点图标未加载：${symbolName}`);
    }

    // 独立的 SVG 图片保留原 Symbol 的多色填充，避免 Canvas 字体版丢失彩色图案。
    const viewBox = symbol.getAttribute("viewBox") ?? "0 0 1024 1024";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${viewBox}">${symbol.innerHTML}</svg>`;
    const objectUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    try {
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  })();

  markerCache.set(symbolName, marker);
  marker.catch(() => markerCache.delete(symbolName));
  return marker;
}
