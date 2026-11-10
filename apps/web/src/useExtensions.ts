import { useEffect, useRef, useState } from "react";
import type { LayerDescriptor } from "@dtv/contracts";
import {
  parsePluginCatalog,
  parsePluginManifest,
  verifyPluginIntegrity,
  verifyPluginSignature,
  type MapFacade,
  type PluginManifest,
} from "@dtv/sdk";
import { pluginTrustRoots } from "./pluginTrustRoots.generated";
import { createPluginSandbox, type PluginSandboxHandle } from "./pluginSandbox";

export interface PopupExtension {
  label: string;
  description: string;
}
const apiVersion = "1.0.0";
/** 在插件层进入地图前校验字段范围，避免任意对象污染核心图层注册表。 */
function validLayer(value: unknown): value is LayerDescriptor {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(item.id) &&
    typeof item.name === "string" && item.name.length <= 100 &&
    ["weather", "base", "station"].includes(String(item.category)) &&
    typeof item.tag === "string" && item.tag.length <= 40 &&
    typeof item.datasetKey === "string" && item.datasetKey.length <= 80 &&
    ["station", "grid", "boundary", "unavailable"].includes(String(item.rendererType)) &&
    typeof item.opacitySupported === "boolean" &&
    typeof item.defaultOpacity === "number" && item.defaultOpacity >= 0 && item.defaultOpacity <= 1 &&
    typeof item.unit === "string" && item.unit.length <= 20 &&
    typeof item.available === "boolean";
}

export function useExtensions(map: MapFacade | null) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const alive = useRef(true);
  const handles = useRef(new Map<string, PluginSandboxHandle>());
  const pluginLayerIds = useRef(new Map<string, Set<string>>());
  const [layers, setLayers] = useState<LayerDescriptor[]>([]),
    [popup, setPopup] = useState<PopupExtension | null>(null),
    [plugins, setPlugins] = useState<PluginManifest[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [installedIds, setInstalledIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [discovering, setDiscovering] = useState(true),
    [error, setError] = useState("");

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    // 清单、签名和 API 版本全部验证通过后才创建隔离 iframe。
    async function discover() {
      try {
        const response = await fetch("/extensions/catalog.json", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("插件目录不可用");
        const paths = parsePluginCatalog(await response.json());
        const found = await Promise.all(paths.map(async (path) => {
          const manifestResponse = await fetch(path, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!manifestResponse.ok) throw new Error("插件清单不可用");
          const manifest = parsePluginManifest(
            await manifestResponse.json(), Number(apiVersion.split(".")[0]),
          );
          if (!(await verifyPluginSignature(manifest, pluginTrustRoots)))
            throw new Error(`插件签名无效或签名根不受信任：${manifest.id}`);
          return manifest;
        }));
        if (new Set(found.map((plugin) => plugin.id)).size !== found.length)
          throw new Error("插件 ID 重复");
        if (!controller.signal.aborted) {
          setPlugins(found);
          setSelectedId((current) => current || found[0]?.id || "");
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "插件发现失败");
      } finally {
        if (!controller.signal.aborted) setDiscovering(false);
      }
    }
    void discover();
    return () => {
      alive.current = false;
      controller.abort();
      for (const handle of handles.current.values()) void handle.unload();
      handles.current.clear();
    };
  }, []);

  const selected = plugins.find((plugin) => plugin.id === selectedId) ?? null;
  const installed = !!selected && installedIds.includes(selected.id);
  async function toggle() {
    if (busy || !selected) return;
    setBusy(true);
    setError("");
    try {
      const previous = handles.current.get(selected.id);
      if (previous) {
        await previous.unload();
        handles.current.delete(selected.id);
        if (alive.current) setInstalledIds([...handles.current.keys()]);
        return;
      }
      if (!(await verifyPluginSignature(selected, pluginTrustRoots)))
        throw new Error("插件签名校验失败");
      const response = await fetch(selected.entry, { cache: "no-store" });
      if (!response.ok) throw new Error("插件入口不可用");
      const source = await response.text();
      if (!(await verifyPluginIntegrity(selected, source)))
        throw new Error("插件完整性校验失败");
      const handle = await createPluginSandbox(selected, source, {
        onSlot: (id, value) => {
          if (id !== "station.popup.footer") return;
          const candidate = value as Partial<PopupExtension>;
          if (typeof candidate?.label !== "string" || typeof candidate.description !== "string") return;
          setPopup({ label: candidate.label.slice(0, 100), description: candidate.description.slice(0, 300) });
        },
        onSlotRemoved: (id) => { if (id === "station.popup.footer") setPopup(null); },
        onLayer: (layer, id) => {
          if (layer && validLayer(layer)) {
            const ids = pluginLayerIds.current.get(selected.id) ?? new Set<string>();
            ids.add(layer.id);
            pluginLayerIds.current.set(selected.id, ids);
            setLayers((old) => [...old.filter((item) => item.id !== layer.id), layer]);
          } else if (id) {
            pluginLayerIds.current.get(selected.id)?.delete(id);
            setLayers((old) => old.filter((item) => item.id !== id));
          }
        },
        onMap: (action, args) => {
          const facade = mapRef.current;
          if (action === "flyTo" && typeof args[0] === "number" && typeof args[1] === "number") facade?.flyTo(args[0], args[1], typeof args[2] === "number" ? args[2] : undefined);
          else if (action === "zoom" && typeof args[0] === "number") facade?.zoom(args[0]);
          else if (action === "north") facade?.north();
          else if (action === "setMode" && (args[0] === "2d" || args[0] === "3d")) facade?.setMode(args[0]);
        },
        onEvent: (name, payload) => window.dispatchEvent(new CustomEvent(`dtv:${name}`, { detail: payload })),
        onDisposed: () => {
          if (!alive.current) return;
          setPopup(null);
          const ids = pluginLayerIds.current.get(selected.id) ?? new Set<string>();
          setLayers((old) => old.filter((layer) => !ids.has(layer.id)));
          pluginLayerIds.current.delete(selected.id);
        },
      });
      if (!alive.current) {
        await handle.unload();
        return;
      }
      handles.current.set(selected.id, handle);
      setInstalledIds([...handles.current.keys()]);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "插件加载失败");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return {
    layers, popup, plugins, selected, selectedId, setSelectedId, installed,
    busy, discovering, error, toggle,
  };
}
