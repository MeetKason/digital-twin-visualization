import type { LayerDescriptor } from "@dtv/contracts";
import type { PluginManifest } from "@dtv/sdk";

export interface PluginSandboxCallbacks {
  onSlot(id: string, value: unknown): void;
  onSlotRemoved(id: string): void;
  onLayer(layer: LayerDescriptor | null, id?: string): void;
  onMap(action: string, args: unknown[]): void;
  onEvent(name: string, payload: unknown): void;
  onDisposed(): void;
}

export interface PluginSandboxHandle {
  unload(): Promise<void>;
}

const channel = "dtv-plugin-v1";
function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

/** 在无同源权限的 iframe 中运行插件，只开放白名单消息 API。 */
export async function createPluginSandbox(
  manifest: PluginManifest,
  source: string,
  callbacks: PluginSandboxCallbacks,
): Promise<PluginSandboxHandle> {
  // 插件代码被编码后放入无同源、无网络权限的 iframe，宿主仅接收白名单消息。
  const iframe = document.createElement("iframe");
  const nonce = crypto.randomUUID();
  const encodedSource = base64(source);
  const config = JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    coreApi: manifest.coreApi,
    nonce,
    encodedSource,
  }).replace(/</g, "\\u003c");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.title = `已隔离插件 ${manifest.id}`;
  iframe.style.cssText = "display:none;width:0;height:0;border:0";
  iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; connect-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'"><script>
const config=${config};
let cleanup=async()=>{};
const send=(type,payload={})=>parent.postMessage({channel:${JSON.stringify(channel)},nonce:config.nonce,id:config.id,type,payload},"*");
const api={apiVersion:"1.0.0",map:{flyTo:(...args)=>send("map",{action:"flyTo",args}),zoom:(...args)=>send("map",{action:"zoom",args}),north:(...args)=>send("map",{action:"north",args}),setMode:(...args)=>send("map",{action:"setMode",args})},layers:{register:(layer)=>{send("layer.register",{layer});return()=>send("layer.remove",{id:layer&&layer.id})}},slots:{register:(id,value)=>{send("slot.register",{id,value});return()=>send("slot.remove",{id})}},events:{emit:(name,payload)=>send("event.emit",{name,payload})}};
addEventListener("message",async event=>{if(event.source!==parent||event.data?.channel!==${JSON.stringify(channel)}||event.data?.nonce!==config.nonce)return;if(event.data.type==="activate"){try{const url="data:text/javascript;base64,"+config.encodedSource;const plugin=(await import(url)).default;if(!plugin||plugin.manifest?.id!==config.id||plugin.manifest?.version!==config.version||plugin.manifest?.coreApi!==config.coreApi)throw Error("插件模块与签名清单不一致");const dispose=await plugin.activate(api);if(typeof dispose==="function")cleanup=dispose;send("ready")}catch(error){send("error",{message:String(error?.message||"插件启动失败").slice(0,200)})}}else if(event.data.type==="unload"){try{await cleanup();send("unloaded")}catch{send("unloaded")}}});
</script>`;

  let settled = false;
  let acknowledgeUnload!: () => void;
  const unloaded = new Promise<void>((resolve) => { acknowledgeUnload = resolve; });
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolveReadyPromise, rejectReadyPromise) => {
    resolveReady = resolveReadyPromise;
    rejectReady = rejectReadyPromise;
  });
  // 同时核对窗口来源、opaque origin、通道、随机 nonce 和插件 ID，拒绝伪造消息。
  const listener = (event: MessageEvent) => {
    if (
      event.source !== iframe.contentWindow || event.origin !== "null" ||
      event.data?.channel !== channel || event.data?.nonce !== nonce ||
      event.data?.id !== manifest.id
    ) return;
    const payload = event.data.payload as Record<string, unknown> | undefined;
    switch (event.data.type) {
      case "ready":
        settled = true;
        resolveReady();
        break;
      case "error":
        settled = true;
        rejectReady(new Error(typeof payload?.message === "string" ? payload.message : "插件启动失败"));
        break;
      case "slot.register":
        if (typeof payload?.id === "string") callbacks.onSlot(payload.id, payload.value);
        break;
      case "slot.remove":
        if (typeof payload?.id === "string") callbacks.onSlotRemoved(payload.id);
        break;
      case "layer.register":
        if (payload?.layer && typeof payload.layer === "object")
          callbacks.onLayer(payload.layer as LayerDescriptor);
        break;
      case "layer.remove":
        if (typeof payload?.id === "string") callbacks.onLayer(null, payload.id);
        break;
      case "map":
        if (["flyTo", "zoom", "north", "setMode"].includes(String(payload?.action)) && Array.isArray(payload?.args))
          callbacks.onMap(String(payload.action), payload.args);
        break;
      case "event.emit":
        if (typeof payload?.name === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(payload.name))
          callbacks.onEvent(payload.name, payload.payload);
        break;
      case "unloaded":
        acknowledgeUnload();
        break;
    }
  };
  window.addEventListener("message", listener);
  iframe.addEventListener("load", () => {
    iframe.contentWindow?.postMessage({ channel, nonce, type: "activate" }, "*");
  }, { once: true });
  document.body.append(iframe);

  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("插件启动超时")), 10000)),
    ]);
  } catch (error) {
    window.removeEventListener("message", listener);
    iframe.remove();
    throw error;
  }
  return {
    async unload() {
      if (settled) {
        iframe.contentWindow?.postMessage({ channel, nonce, type: "unload" }, "*");
        await Promise.race([unloaded, new Promise((resolve) => setTimeout(resolve, 1000))]);
      }
      callbacks.onDisposed();
      window.removeEventListener("message", listener);
      iframe.remove();
    },
  };
}
