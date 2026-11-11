import type { DataFrame, LayerDescriptor } from "@dtv/contracts";
import { PluginRequests, type PluginManifest } from "@dtv/sdk";
export interface PluginSandboxCallbacks {
  onSlot(id: string, value: unknown): void;
  onSlotRemoved(id: string): void;
  onLayer(layer: LayerDescriptor | null, id?: string): void;
  onMap(action: string, args: unknown[]): void;
  onEvent(name: string, payload: unknown): void;
  onExtension(kind: "route" | "widget" | "provider", value: unknown): void;
  onExtensionRemoved(id: string): void;
  onData(
    product: string,
    time: string,
    signal: AbortSignal,
  ): Promise<DataFrame>;
  onError(message: string): void;
  onDisposed(): void;
}
export interface PluginSandboxHandle {
  unload(): Promise<void>;
  queryProvider(
    id: string,
    time: string,
    signal: AbortSignal,
  ): Promise<unknown>;
}
const channel = "dtv-plugin-v1";
function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
/** opaque iframe禁止网络、同源和DOM访问，仅通过校验后的消息桥接宿主。 */
export async function createPluginSandbox(
  manifest: PluginManifest,
  source: string,
  callbacks: PluginSandboxCallbacks,
  scene: { id: string; center: [number, number] },
): Promise<PluginSandboxHandle> {
  const iframe = document.createElement("iframe"),
    nonce = crypto.randomUUID();
  const config = JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    coreApi: manifest.coreApi,
    nonce,
    encodedSource: base64(source),
    scene,
  }).replace(/</g, "\\u003c");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.title = `已隔离插件 ${manifest.id}`;
  iframe.style.cssText = "display:none;width:0;height:0;border:0";
  iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; connect-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'"><script>
const config=${config};let cleanup=async()=>{};const providers=new Map(),queries=new Map(),reads=new Map();let sequence=0;
const send=(type,payload={})=>parent.postMessage({channel:${JSON.stringify(channel)},nonce:config.nonce,id:config.id,type,payload},"*");
const register=(kind,value)=>{send("extension.register",{kind,value});return()=>send("extension.remove",{id:value.id})};
const api={apiVersion:"1.0.0",scene:config.scene,map:{flyTo:(...args)=>send("map",{action:"flyTo",args}),zoom:(...args)=>send("map",{action:"zoom",args}),north:(...args)=>send("map",{action:"north",args}),setMode:(...args)=>send("map",{action:"setMode",args})},layers:{register:layer=>{send("layer.register",{layer});return()=>send("layer.remove",{id:layer&&layer.id})}},slots:{register:(id,value)=>{send("slot.register",{id,value});return()=>send("slot.remove",{id})}},events:{emit:(name,payload)=>send("event.emit",{name,payload})},routes:{register:value=>register("route",value)},widgets:{register:value=>register("widget",value)},stationProviders:{register:(value,fn)=>{providers.set(value.id,fn);const remove=register("provider",value);return()=>{providers.delete(value.id);remove()}}},data:{read:(product,time,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted){reject(Error("请求已取消"));return}if(reads.size>=8){reject(Error("并发请求过多"));return}const requestId=String(++sequence);const abort=()=>{reads.delete(requestId);send("data.cancel",{requestId});reject(Error("请求已取消"))};const finish=()=>signal?.removeEventListener("abort",abort);reads.set(requestId,{resolve,reject,finish});signal?.addEventListener("abort",abort,{once:true});send("data.request",{requestId,product,time})})}};
addEventListener("message",async event=>{if(event.source!==parent||event.data?.channel!==${JSON.stringify(channel)}||event.data?.nonce!==config.nonce)return;const p=event.data.payload||{};switch(event.data.type){
case "activate":try{const plugin=(await import("data:text/javascript;base64,"+config.encodedSource)).default;if(!plugin||plugin.manifest?.id!==config.id||plugin.manifest?.version!==config.version||plugin.manifest?.coreApi!==config.coreApi)throw Error("插件模块与签名清单不一致");const dispose=await plugin.activate(api);if(typeof dispose!=="function")throw Error("插件必须返回清理函数");cleanup=dispose;send("ready")}catch(error){send("error",{message:String(error?.message||"插件启动失败").slice(0,200)})}break;
case "provider.query":{const controller=new AbortController();queries.set(p.requestId,controller);try{const provide=providers.get(p.id);if(!provide)throw Error("站点Provider已卸载");const value=await provide({sceneId:config.scene.id,time:p.time,signal:controller.signal});if(!controller.signal.aborted)send("provider.result",{requestId:p.requestId,value})}catch(error){if(!controller.signal.aborted)send("provider.result",{requestId:p.requestId,error:String(error?.message||"Provider失败").slice(0,200)})}finally{queries.delete(p.requestId)}}break;
case "provider.cancel":queries.get(p.requestId)?.abort();queries.delete(p.requestId);break;
case "data.result":{const read=reads.get(p.requestId);if(read){reads.delete(p.requestId);read.finish();p.error?read.reject(Error(p.error)):read.resolve(p.value)}}break;
case "unload":for(const q of queries.values())q.abort();queries.clear();for(const read of reads.values()){read.finish();read.reject(Error("插件已卸载"))}reads.clear();try{await cleanup()}finally{send("unloaded")}break;
}});
</script>`;
  let closed = false,
    settled = false;
  const post = (type: string, payload: unknown) =>
    iframe.contentWindow?.postMessage({ channel, nonce, type, payload }, "*");
  const requests = new PluginRequests(
    (requestId, payload) =>
      post("provider.query", { ...(payload as object), requestId }),
    10000,
    (requestId) => post("provider.cancel", { requestId }),
  );
  const reads = new Map<string, AbortController>();
  let resolveReady!: () => void,
    rejectReady!: (e: Error) => void,
    acknowledgeUnload!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const unloaded = new Promise<void>((resolve) => {
    acknowledgeUnload = resolve;
  });
  function dispose() {
    if (closed) return;
    closed = true;
    requests.dispose();
    for (const controller of reads.values()) controller.abort();
    reads.clear();
    window.removeEventListener("message", listener);
    iframe.remove();
    callbacks.onDisposed();
  }
  const listener = (event: MessageEvent) => {
    if (
      closed ||
      event.source !== iframe.contentWindow ||
      event.origin !== "null" ||
      event.data?.channel !== channel ||
      event.data?.nonce !== nonce ||
      event.data?.id !== manifest.id
    )
      return;
    const p = event.data.payload as Record<string, unknown> | undefined;
    try {
      switch (event.data.type) {
        case "ready":
          if (!settled) {
            settled = true;
            resolveReady();
          }
          break;
        case "error": {
          const error = new Error(
            typeof p?.message === "string"
              ? p.message.slice(0, 200)
              : "插件启动失败",
          );
          if (!settled) {
            settled = true;
            rejectReady(error);
          } else callbacks.onError(error.message);
          break;
        }
        case "slot.register":
          if (typeof p?.id === "string") callbacks.onSlot(p.id, p.value);
          break;
        case "slot.remove":
          if (typeof p?.id === "string") callbacks.onSlotRemoved(p.id);
          break;
        case "layer.register":
          if (p?.layer && typeof p.layer === "object")
            callbacks.onLayer(p.layer as LayerDescriptor);
          break;
        case "layer.remove":
          if (typeof p?.id === "string") callbacks.onLayer(null, p.id);
          break;
        case "extension.register":
          if (["route", "widget", "provider"].includes(String(p?.kind)))
            callbacks.onExtension(
              p!.kind as "route" | "widget" | "provider",
              p!.value,
            );
          break;
        case "extension.remove":
          if (typeof p?.id === "string") callbacks.onExtensionRemoved(p.id);
          break;
        case "provider.result":
          if (typeof p?.requestId === "string")
            requests.resolve(
              p.requestId,
              p.value,
              typeof p.error === "string" ? p.error : undefined,
            );
          break;
        case "data.cancel":
          if (typeof p?.requestId === "string") {
            reads.get(p.requestId)?.abort();
            reads.delete(p.requestId);
          }
          break;
        case "data.request": {
          if (
            typeof p?.requestId !== "string" ||
            !/^\d{1,10}$/.test(p.requestId) ||
            typeof p.product !== "string" ||
            typeof p.time !== "string"
          )
            break;
          const requestId = p.requestId;
          if (reads.size >= 8 || reads.has(requestId))
            throw new Error("插件数据请求过多");
          const controller = new AbortController();
          reads.set(requestId, controller);
          void callbacks
            .onData(
              p.product,
              p.time,
              AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
            )
            .then((value) => {
              if (!closed && !controller.signal.aborted)
                post("data.result", { requestId, value });
            })
            .catch(() => {
              if (!closed && !controller.signal.aborted)
                post("data.result", {
                  requestId,
                  error: "授权数据读取失败，请检查产品和时次",
                });
            })
            .finally(() => {
              reads.delete(requestId);
            });
          break;
        }
        case "map":
          if (
            ["flyTo", "zoom", "north", "setMode"].includes(String(p?.action)) &&
            Array.isArray(p?.args)
          )
            callbacks.onMap(String(p.action), p.args);
          break;
        case "event.emit":
          if (
            typeof p?.name === "string" &&
            /^[a-zA-Z0-9._-]{1,80}$/.test(p.name)
          )
            callbacks.onEvent(p.name, p.payload);
          break;
        case "unloaded":
          acknowledgeUnload();
          break;
      }
    } catch {
      if (!settled) {
        settled = true;
        rejectReady(new Error("插件扩展注册无效"));
      } else callbacks.onError("插件扩展注册无效");
    }
  };
  window.addEventListener("message", listener);
  iframe.addEventListener("load", () => post("activate", {}), { once: true });
  document.body.append(iframe);
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectReady(new Error("插件启动超时"));
    }
  }, 10000);
  try {
    await ready;
  } catch (e) {
    dispose();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return {
    queryProvider(id, time, signal) {
      return requests.request({ id, time }, signal);
    },
    async unload() {
      if (closed) return;
      requests.dispose();
      post("unload", {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        unloaded,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
      clearTimeout(timer);
      dispose();
    },
  };
}
