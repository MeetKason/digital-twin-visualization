import {
  CustomHeightmapTerrainProvider,
  Ellipsoid,
  GeographicTilingScheme,
  type TerrainProvider,
} from "cesium";
import { inflate } from "pako";

const TDT_SUBDOMAINS = ["0", "1", "2", "3", "4", "5", "6", "7"];
const CESIUM_TILE_SIZE = 64;
const TDT_TILE_SIZE = 150;
const TDT_MAX_SERVICE_LEVEL = 12;
const TDT_MAX_CESIUM_LEVEL = TDT_MAX_SERVICE_LEVEL - 1;
const TDT_MIN_CESIUM_LEVEL = 5;
const MAX_CONCURRENT_TERRAIN_REQUESTS = 4;
const EMPTY_HEIGHTMAP = new Float32Array(
  CESIUM_TILE_SIZE * CESIUM_TILE_SIZE,
);
let activeTerrainRequests = 0;
const terrainRequestQueue: Array<() => void> = [];

/** 限制自定义 fetch 的并发量，避免低角度视角瞬间打满天地图服务。 */
async function withTerrainRequestSlot<T>(request: () => Promise<T>): Promise<T> {
  if (activeTerrainRequests >= MAX_CONCURRENT_TERRAIN_REQUESTS) {
    await new Promise<void>((resolve) => terrainRequestQueue.push(resolve));
  }
  activeTerrainRequests += 1;
  try {
    return await request();
  } finally {
    activeTerrainRequests -= 1;
    terrainRequestQueue.shift()?.();
  }
}

/** 网络抖动、限流或 5xx 时短暂重试一次；其他授权错误直接交给 Cesium 处理。 */
async function fetchTerrainTile(url: URL): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await withTerrainRequestSlot(() =>
        fetch(url, {
          mode: "cors",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        }),
      );
    } catch (error) {
      lastError = error;
    }
    if (response?.ok) return new Uint8Array(await response.arrayBuffer());
    if (response) {
      lastError = new Error(`天地图高程请求失败（HTTP ${response.status}）`);
      if (response.status !== 429 && response.status < 500) throw lastError;
    }
    if (attempt === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("天地图高程请求失败");
}

/**
 * 创建 Cesium 可用的天地图三维高程 Provider。
 * 天地图 swdx 返回 zlib 压缩的 150×150 高程样本，按官方瓦片约定解码后重采样为 Cesium 高程网格。
 */
export function createTiandituTerrainProvider(key: string): TerrainProvider {
  const provider = new CustomHeightmapTerrainProvider({
    width: CESIUM_TILE_SIZE,
    height: CESIUM_TILE_SIZE,
    tilingScheme: new GeographicTilingScheme({ ellipsoid: Ellipsoid.WGS84 }),
    credit: "天地图高程服务",
    callback: async (x, y, level) => {
      // 低层级使用零高程占位，避免视野很大时请求过多粗分辨率瓦片。
      if (level < TDT_MIN_CESIUM_LEVEL) {
        return new Float32Array(EMPTY_HEIGHTMAP);
      }
      // 服务最高支持 l=12；Cesium 的 0 级对应天地图服务的 l=1。
      if (level > TDT_MAX_CESIUM_LEVEL) {
        return new Float32Array(EMPTY_HEIGHTMAP);
      }

      const subdomain = TDT_SUBDOMAINS[(x + y) % TDT_SUBDOMAINS.length];
      const url = new URL(
        `https://t${subdomain}.tianditu.gov.cn/mapservice/swdx`,
      );
      url.search = new URLSearchParams({
        T: "elv_c",
        x: String(x),
        y: String(y),
        l: String(level + 1),
        tk: key,
      }).toString();

      // 解压失败或采样长度不符时抛错，让 Cesium 的 terrain errorEvent 负责回退提示。
      const compressed = await fetchTerrainTile(url);
      const source = inflate(compressed);
      return decodeTiandituHeightmap(source);
    },
  });

  // 告诉 Cesium 服务的最高数据级别，避免继续请求天地图明确不提供的 l=13 及以上数据。
  provider.getTileDataAvailable = (_x, _y, level) =>
    level <= TDT_MAX_CESIUM_LEVEL;

  // CustomHeightmapTerrainProvider 在运行时实现 TerrainProvider 所需接口；Cesium 的类型声明未将其纳入接口。
  return provider as unknown as TerrainProvider;
}

/** 将天地图压缩瓦片的 150×150 原始高程采样转换为 Cesium 64×64 米制高程数组。 */
function decodeTiandituHeightmap(source: Uint8Array): Float32Array {
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
        : view.getUint16(offset, true);
      heights[row * CESIUM_TILE_SIZE + column] =
        Number.isFinite(height) && height >= -2000 && height <= 10000
          ? height
          : 0;
    }
  }

  return heights;
}
