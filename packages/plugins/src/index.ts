import type { PlatformPlugin } from "@dtv/sdk";
export const stationPopupPlugin: PlatformPlugin = {
  manifest: { id: "example.station-popup", version: "1.0.0", coreApi: 1 },
  async activate(ctx) {
    return ctx.slots.register("station.popup.footer", {
      label: "客户扩展示例",
      description: "由 SDK 插槽注册；卸载后清理",
    });
  },
};
export default stationPopupPlugin;
