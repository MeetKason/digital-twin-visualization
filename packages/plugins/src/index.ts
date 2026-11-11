import type { PlatformPlugin } from "@dtv/sdk";
/** 同一签名示例演示弹框、独立菜单、地图Widget和异步站点Provider。 */
export const stationPopupPlugin: PlatformPlugin = {
  manifest: { id: "example.station-popup", version: "1.0.0", coreApi: 1 },
  async activate(ctx) {
    const cleanups: (() => void)[] = [];
    try {
      cleanups.push(
        ctx.slots.register("station.popup.footer", {
          label: "客户扩展示例",
          description: "由 SDK 插槽注册；卸载后清理",
        }),
      );
      cleanups.push(
        ctx.routes.register({
          id: "example.station-popup.overview",
          title: "客户扩展专题",
          description:
            "独立插件注册的菜单页面；数据读取仍受当前会话与租户产品授权约束。",
          rows: [
            { label: "场景", value: ctx.scene.id },
            { label: "数据来源", value: "Mock 示例，不代表真实实况" },
          ],
          action: {
            label: "定位当前场景",
            lon: ctx.scene.center[0],
            lat: ctx.scene.center[1],
            height: 145000,
          },
        }),
      );
      cleanups.push(
        ctx.widgets.register({
          id: "example.station-popup.widget",
          title: "客户扩展演示",
          value: "Mock",
          description: "Widget由宿主Ant卡片渲染，插件卸载后自动移除。",
        }),
      );
      cleanups.push(
        ctx.stationProviders.register(
          {
            id: "example.station-popup.observations",
            name: "客户站点观测",
            datasetKey: "surface-hourly",
            source: "mock",
            unit: "°C",
          },
          async (query) =>
            ctx.data.read("surface-hourly", query.time, query.signal),
        ),
      );
      return () => {
        for (const cleanup of cleanups.reverse()) cleanup();
      };
    } catch (error) {
      for (const cleanup of cleanups.reverse()) cleanup();
      throw error;
    }
  },
};
export default stationPopupPlugin;
