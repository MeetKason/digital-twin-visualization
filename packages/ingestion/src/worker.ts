import {
  demoObservations,
  demoProductObservations,
  SceneSchema,
  MOCK_LAYER_PRODUCTS,
  type WeatherObservation,
  type MockGridProduct,
  type SceneConfig,
  layerForProduct,
} from "@dtv/contracts";
import xian from "../../../scenarios/xian.json";
import taiyuan from "../../../scenarios/taiyuan.json";
import chengdu from "../../../scenarios/chengdu.json";
import type { IngestionStore } from "./state";
import {
  loadTianqingConfig,
  TianqingClient,
  TianqingRegistry,
} from "./tianqing";
const mockGridProducts: Set<string> = new Set(
  Object.values(MOCK_LAYER_PRODUCTS),
);
export interface SceneConnector {
  fetch(
    sceneId: string,
    time: string,
    signal?: AbortSignal,
    source?: "mock" | "tianqing",
    productId?: string,
    tenantId?: string,
  ): Promise<WeatherObservation[]>;
}
export class MockSceneConnector implements SceneConnector {
  constructor(
    private readonly resolveScene?: (
      sceneId: string,
      tenantId: string,
    ) => Promise<SceneConfig>,
  ) {}
  /** 按地区站点和产品类型生成可重复样本，所有结果均带 Mock 来源。 */
  async fetch(
    sceneId: string,
    time: string,
    signal?: AbortSignal,
    _source?: "mock" | "tianqing",
    productId = "surface-hourly",
    tenantId?: string,
  ) {
    if (signal?.aborted) throw new Error("Mock 采集已取消");
    const raw =
      this.resolveScene && tenantId
        ? await this.resolveScene(sceneId, tenantId)
        : [xian, taiyuan, chengdu].find((s) => s.id === sceneId);
    const config = raw ? SceneSchema.parse(raw) : null;
    if (!config) throw new Error("未知场景");
    const layerId = layerForProduct(productId);
    if (
      config.enabledLayers &&
      layerId &&
      !config.enabledLayers.includes(layerId)
    )
      throw new Error("当前场景未启用该产品");
    if (mockGridProducts.has(productId))
      return demoProductObservations(
        SceneSchema.parse(config),
        time,
        productId as MockGridProduct,
      );
    if (productId !== "surface-hourly")
      throw new Error(`未知 Mock 产品 ${productId}`);
    return demoObservations(SceneSchema.parse(config), time);
  }
}
/** 根据持久任务的来源路由连接器，保持 Mock 和真实数据源互不伪装。 */
export class ConfiguredSceneConnector implements SceneConnector {
  private readonly mock: MockSceneConnector;
  private readonly tianqing: TianqingClient;

  constructor(
    private readonly registry: TianqingRegistry = loadTianqingConfig(),
    resolveScene?: (sceneId: string, tenantId: string) => Promise<SceneConfig>,
    private authorize?: (
      tenant: string,
      scene: string,
      product: string,
    ) => Promise<void>,
  ) {
    this.mock = new MockSceneConnector(resolveScene);
    this.tianqing = new TianqingClient(registry);
  }

  /** 按持久任务来源路由；未实现的真实产品明确失败，不伪造为 Mock。 */
  async fetch(
    sceneId: string,
    time: string,
    signal?: AbortSignal,
    source: "mock" | "tianqing" = "mock",
    productId = "surface-hourly",
    tenantId?: string,
  ): Promise<WeatherObservation[]> {
    if (this.authorize && tenantId)
      await this.authorize(tenantId, sceneId, productId);
    if (source === "mock")
      return this.mock.fetch(
        sceneId,
        time,
        signal,
        source,
        productId,
        tenantId,
      );
    if (productId !== "surface-hourly")
      throw new Error(`天擎产品 ${productId} 尚未配置数据连接器`);
    return this.tianqing.fetch(sceneId, time, signal);
  }
}
export class QueueWorker {
  constructor(
    private readonly store: IngestionStore,
    private readonly connector: SceneConnector = new ConfiguredSceneConnector(),
    private readonly id = `worker-${process.pid}`,
  ) {}
  /** 领取一个租约，执行有时限的采集，再提交结果或保存脱敏失败状态。 */
  async tick() {
    const lease = await this.store.claim(this.id);
    if (!lease) return false;
    try {
      const signal = AbortSignal.timeout(30000);
      const rows = await Promise.race([
        this.connector.fetch(
          lease.sceneId,
          lease.job.cursor,
          signal,
          lease.job.source,
          lease.job.productId,
          lease.tenantId,
        ),
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("采集超时")),
            { once: true },
          ),
        ),
      ]);
      await this.store.complete(lease, rows);
    } catch {
      // 持久化错误信息不包含客户响应正文、令牌或连接配置，避免敏感信息进入任务记录。
      await this.store.fail(
        lease,
        "采集或观测校验失败，请检查源与执行器日志后重试",
      );
    }
    return true;
  }
}
