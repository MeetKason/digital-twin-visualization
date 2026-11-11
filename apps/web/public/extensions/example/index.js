// packages/plugins/src/index.ts
var stationPopupPlugin = {
  manifest: { id: "example.station-popup", version: "1.0.0", coreApi: 1 },
  async activate(ctx) {
    const cleanups = [];
    try {
      cleanups.push(
        ctx.slots.register("station.popup.footer", {
          label: "\u5BA2\u6237\u6269\u5C55\u793A\u4F8B",
          description: "\u7531 SDK \u63D2\u69FD\u6CE8\u518C\uFF1B\u5378\u8F7D\u540E\u6E05\u7406"
        })
      );
      cleanups.push(
        ctx.routes.register({
          id: "example.station-popup.overview",
          title: "\u5BA2\u6237\u6269\u5C55\u4E13\u9898",
          description: "\u72EC\u7ACB\u63D2\u4EF6\u6CE8\u518C\u7684\u83DC\u5355\u9875\u9762\uFF1B\u6570\u636E\u8BFB\u53D6\u4ECD\u53D7\u5F53\u524D\u4F1A\u8BDD\u4E0E\u79DF\u6237\u4EA7\u54C1\u6388\u6743\u7EA6\u675F\u3002",
          rows: [
            { label: "\u573A\u666F", value: ctx.scene.id },
            { label: "\u6570\u636E\u6765\u6E90", value: "Mock \u793A\u4F8B\uFF0C\u4E0D\u4EE3\u8868\u771F\u5B9E\u5B9E\u51B5" }
          ],
          action: {
            label: "\u5B9A\u4F4D\u5F53\u524D\u573A\u666F",
            lon: ctx.scene.center[0],
            lat: ctx.scene.center[1],
            height: 145e3
          }
        })
      );
      cleanups.push(
        ctx.widgets.register({
          id: "example.station-popup.widget",
          title: "\u5BA2\u6237\u6269\u5C55\u6F14\u793A",
          value: "Mock",
          description: "Widget\u7531\u5BBF\u4E3BAnt\u5361\u7247\u6E32\u67D3\uFF0C\u63D2\u4EF6\u5378\u8F7D\u540E\u81EA\u52A8\u79FB\u9664\u3002"
        })
      );
      cleanups.push(
        ctx.stationProviders.register(
          {
            id: "example.station-popup.observations",
            name: "\u5BA2\u6237\u7AD9\u70B9\u89C2\u6D4B",
            datasetKey: "surface-hourly",
            source: "mock",
            unit: "\xB0C"
          },
          async (query) => ctx.data.read("surface-hourly", query.time, query.signal)
        )
      );
      return () => {
        for (const cleanup of cleanups.reverse()) cleanup();
      };
    } catch (error) {
      for (const cleanup of cleanups.reverse()) cleanup();
      throw error;
    }
  }
};
var index_default = stationPopupPlugin;
export {
  index_default as default,
  stationPopupPlugin
};
