import { TerrainResourceClient } from "./terrainResource";
import { TerrainTileClient } from "./terrainRequests";
import {
  Credit,
  CustomHeightmapTerrainProvider,
  Ellipsoid,
  GeographicTilingScheme,
  HeightmapTerrainData,
  type Request as CesiumRequest,
  type TerrainProvider,
} from "cesium";
import { inflate } from "pako";

const TDT_SUBDOMAINS = ["0", "1", "2", "3", "4", "5", "6", "7"];
const CESIUM_TILE_SIZE = 64;
const TDT_TILE_SIZE = 150;
const TDT_MAX_SERVICE_LEVEL = 12;
const TDT_MAX_CESIUM_LEVEL = TDT_MAX_SERVICE_LEVEL - 1;
const TDT_MIN_CESIUM_LEVEL = 5;
const EMPTY_HEIGHTMAP = new Float32Array(CESIUM_TILE_SIZE * CESIUM_TILE_SIZE);

/**
 * 创建 Cesium 可用的天地图三维高程 Provider。
 * 天地图 swdx 返回 zlib 压缩的 150×150 高程样本，按官方瓦片约定解码后重采样为 Cesium 高程网格。
 */
export function createTiandituTerrainProvider(key: string): TerrainProvider & { dispose(): void } {
  const client = new TerrainTileClient();
  const resources = new TerrainResourceClient();
  const tileUrl = (x: number, y: number, level: number) => {
    const subdomain = TDT_SUBDOMAINS[(x + y) % TDT_SUBDOMAINS.length];
    const url = new URL(`https://t${subdomain}.tianditu.gov.cn/mapservice/swdx`);
    url.search = new URLSearchParams({ T: "elv_c", x: String(x), y: String(y), l: String(level + 1), tk: key }).toString();
    return url.toString();
  };
  const zeroLevel = (level: number) => level < TDT_MIN_CESIUM_LEVEL || level > TDT_MAX_CESIUM_LEVEL;
  const provider = new CustomHeightmapTerrainProvider({
    width: CESIUM_TILE_SIZE, height: CESIUM_TILE_SIZE,
    tilingScheme: new GeographicTilingScheme({ ellipsoid: Ellipsoid.WGS84 }),
    credit: new Credit("天地图高程服务", true),
    callback: async (x, y, level) => zeroLevel(level) ? new Float32Array(EMPTY_HEIGHTMAP)
      : decodeTiandituHeightmap(inflate(await client.load(tileUrl(x, y, level)))),
  });
  // 默认回调不传递Request，显式通过Resource转交单瓦片取消，取消版本兼容逻辑集中在TerrainResourceClient。
  provider.requestTileGeometry = (x: number, y: number, level: number, request?: CesiumRequest) => {
    let bytes: Promise<Uint8Array> | undefined;
    if (!zeroLevel(level)) {
      bytes = request ? resources.load(tileUrl(x, y, level), request) : client.load(tileUrl(x, y, level));
      if (!bytes) return undefined;
    }
    return (bytes ?? Promise.resolve(null)).then((compressed) => new HeightmapTerrainData({
      buffer: compressed ? decodeTiandituHeightmap(inflate(compressed)) : new Float32Array(EMPTY_HEIGHTMAP),
      width: CESIUM_TILE_SIZE, height: CESIUM_TILE_SIZE,
      childTileMask: level >= TDT_MAX_CESIUM_LEVEL ? 0 : 15,
    }));
  };

  // 告诉 Cesium 服务的最高数据级别，避免继续请求天地图明确不提供的 l=13 及以上数据。
  provider.getTileDataAvailable = (_x, _y, level) =>
    level <= TDT_MAX_CESIUM_LEVEL;

  // CustomHeightmapTerrainProvider 在运行时实现 TerrainProvider 所需接口；Cesium 的类型声明未将其纳入接口。
  return Object.assign(provider, { dispose: () => { client.dispose(); resources.dispose(); } }) as unknown as TerrainProvider & { dispose(): void };
}

/** 将天地图压缩瓦片的 150×150 原始高程采样转换为 Cesium 64×64 米制高程数组。 */
export function decodeTiandituHeightmap(source: Uint8Array): Float32Array {
  const isFloat32 = source.byteLength === TDT_TILE_SIZE * TDT_TILE_SIZE * 4;
  const isInt16 = source.byteLength === TDT_TILE_SIZE * TDT_TILE_SIZE * 2;
  if (!isFloat32 && !isInt16) {
    throw new Error(`天地图高程瓦片长度异常（${source.byteLength} 字节）`);
  }

  const view = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  );
  const heights = new Float32Array(CESIUM_TILE_SIZE * CESIUM_TILE_SIZE);

  for (let row = 0; row < CESIUM_TILE_SIZE; row += 1) {
    // 保持天地图官方 Cesium 解码器的端点对齐方式，抽取 150×150 网格中的 64×64 样本。
    const sourceRow = Math.floor(
      ((TDT_TILE_SIZE - 1) * row) / (CESIUM_TILE_SIZE - 1),
    );
    for (let column = 0; column < CESIUM_TILE_SIZE; column += 1) {
      const sourceColumn = Math.floor(
        ((TDT_TILE_SIZE - 1) * column) / (CESIUM_TILE_SIZE - 1),
      );
      const bytesPerSample = isFloat32 ? 4 : 2;
      const offset =
        (sourceRow * TDT_TILE_SIZE + sourceColumn) * bytesPerSample;
      // 天地图整数高程样本使用小端序；浮点样本使用小端 IEEE-754 编码。
      const height = isFloat32
        ? view.getFloat32(offset, true)
        : view.getInt16(offset, true);
      heights[row * CESIUM_TILE_SIZE + column] =
        Number.isFinite(height) && height >= -2000 && height <= 10000
          ? height
          : 0;
    }
  }

  return heights;
}
