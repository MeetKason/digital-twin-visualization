// packages/plugins/src/index.ts
var stationPopupPlugin = {
  manifest: { id: "example.station-popup", version: "1.0.0", coreApi: 1 },
  async activate(ctx) {
    return ctx.slots.register("station.popup.footer", {
      label: "\u5BA2\u6237\u6269\u5C55\u793A\u4F8B",
      description: "\u7531 SDK \u63D2\u69FD\u6CE8\u518C\uFF1B\u5378\u8F7D\u540E\u6E05\u7406"
    });
  }
};
var index_default = stationPopupPlugin;
export {
  index_default as default,
  stationPopupPlugin
};
