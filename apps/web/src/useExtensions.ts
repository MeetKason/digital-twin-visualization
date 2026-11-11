import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataFrame, LayerDescriptor, SceneConfig } from "@dtv/contracts";
import {
  ExtensionRegistry,
  parseProviderFrame,
  parsePluginCatalog,
  parsePluginManifest,
  verifyPluginIntegrity,
  verifyPluginSignature,
  type MapFacade,
  type PluginManifest,
} from "@dtv/sdk";
import { pluginTrustRoots } from "./pluginTrustRoots.generated";
import { createPluginSandbox, type PluginSandboxHandle } from "./pluginSandbox";
import { sessionFetch } from "./sessionRequest";
export interface PopupExtension {
  label: string;
  description: string;
}
function validLayer(value: LayerDescriptor, owner: string) {
  return (
    typeof value.id === "string" &&
    value.id.startsWith(`${owner}.`) &&
    value.id.length <= 120 &&
    typeof value.name === "string" &&
    value.name.length <= 100 &&
    ["station", "grid", "boundary", "unavailable"].includes(
      value.rendererType,
    ) &&
    ["weather", "base", "station"].includes(value.category) &&
    typeof value.tag === "string" &&
    value.tag.length <= 40 &&
    typeof value.datasetKey === "string" &&
    value.datasetKey.length <= 80 &&
    typeof value.unit === "string" &&
    value.unit.length <= 20 &&
    typeof value.available === "boolean" &&
    typeof value.opacitySupported === "boolean" &&
    Number.isFinite(value.defaultOpacity) &&
    value.defaultOpacity >= 0 &&
    value.defaultOpacity <= 1
  );
}
/** 每个插件分别拥有注册项；切换场景、禁用授权或启动失败均清理沙箱和请求。 */
export function useExtensions(
  map: MapFacade | null,
  scene: SceneConfig,
  enabled = true,
) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const handles = useRef(new Map<string, PluginSandboxHandle>()),
    epoch = useRef(0),
    alive = useRef(true);
  const registry = useRef(new ExtensionRegistry()),
    popups = useRef(new Map<string, PopupExtension>());
  const contributedLayers = useRef(
    new Map<string, { owner: string; layer: LayerDescriptor }>(),
  );
  const [revision, change] = useState(0),
    [plugins, setPlugins] = useState<PluginManifest[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [installedIds, setInstalledIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [discovering, setDiscovering] = useState(true),
    [error, setError] = useState("");
  const lifecycle = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    const generation = ++epoch.current;
    const controller = new AbortController();
    lifecycle.current = controller;
    registry.current = new ExtensionRegistry();
    contributedLayers.current.clear();
    popups.current.clear();
    setInstalledIds([]);
    setPlugins([]);
    setDiscovering(enabled);
    setError("");
    setBusy(false);
    change((r) => r + 1);
    if (enabled)
      void (async () => {
        try {
          const response = await fetch("/extensions/catalog.json", {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!response.ok) throw new Error("插件目录不可用");
          const paths = parsePluginCatalog(await response.json());
          const found = await Promise.all(
            paths.map(async (path) => {
              const r = await fetch(path, {
                signal: controller.signal,
                cache: "no-store",
              });
              if (!r.ok) throw new Error("插件清单不可用");
              const manifest = parsePluginManifest(await r.json(), 1);
              if (!(await verifyPluginSignature(manifest, pluginTrustRoots)))
                throw new Error(`插件签名无效或签名根不受信任：${manifest.id}`);
              return manifest;
            }),
          );
          if (new Set(found.map((p) => p.id)).size !== found.length)
            throw new Error("插件ID重复");
          if (!controller.signal.aborted && epoch.current === generation) {
            setPlugins(found);
            setSelectedId((id) =>
              found.some((p) => p.id === id) ? id : (found[0]?.id ?? ""),
            );
          }
        } catch (e) {
          if (!controller.signal.aborted) setError((e as Error).message);
        } finally {
          if (!controller.signal.aborted) setDiscovering(false);
        }
      })();
    return () => {
      alive.current = false;
      ++epoch.current;
      controller.abort();
      for (const handle of handles.current.values()) void handle.unload();
      handles.current.clear();
    };
  }, [scene.id, enabled]);
  const selected = plugins.find((p) => p.id === selectedId) ?? null,
    installed = !!selected && installedIds.includes(selected.id);
  async function toggle() {
    if (busy || !selected || !enabled) return;
    const generation = epoch.current,
      owner = selected.id;
    const current = () =>
      alive.current &&
      generation === epoch.current &&
      !lifecycle.current.signal.aborted;
    const changed = () => {
      if (current()) change((r) => r + 1);
    };
    setBusy(true);
    setError("");
    try {
      const previous = handles.current.get(owner);
      if (previous) {
        await previous.unload();
        handles.current.delete(owner);
        if (current()) setInstalledIds([...handles.current.keys()]);
        return;
      }
      const permission = await sessionFetch(
        `/api/scenes/${encodeURIComponent(scene.id)}/plugins/authorization`,
        { signal: lifecycle.current.signal },
      );
      if (!permission.ok) throw new Error("当前产品未授权插件扩展");
      if (!(await verifyPluginSignature(selected, pluginTrustRoots)))
        throw new Error("插件签名校验失败");
      const response = await fetch(selected.entry, {
        cache: "no-store",
        signal: lifecycle.current.signal,
      });
      if (!response.ok) throw new Error("插件入口不可用");
      const source = await response.text();
      if (source.length > 2 * 1024 * 1024) throw new Error("插件入口过大");
      if (!(await verifyPluginIntegrity(selected, source)))
        throw new Error("插件完整性校验失败");
      if (!current()) return;
      const handle = await createPluginSandbox(
        selected,
        source,
        {
          onSlot(id, value) {
            if (!current() || id !== "station.popup.footer") return;
            const v = value as Partial<PopupExtension>;
            if (
              typeof v?.label !== "string" ||
              typeof v.description !== "string"
            )
              throw new Error("弹框描述无效");
            popups.current.set(owner, {
              label: v.label.slice(0, 100),
              description: v.description.slice(0, 300),
            });
            changed();
          },
          onSlotRemoved(id) {
            if (current() && id === "station.popup.footer") {
              popups.current.delete(owner);
              changed();
            }
          },
          onLayer(layer, id) {
            if (!current()) return;
            if (layer) {
              if (
                !validLayer(layer, owner) ||
                contributedLayers.current.has(layer.id) ||
                registry.current.owner(layer.id) ||
                [...contributedLayers.current.values()].filter(
                  (item) => item.owner === owner,
                ).length >= 24
              )
                throw new Error("图层注册无效");
              contributedLayers.current.set(layer.id, { owner, layer });
            } else if (id && contributedLayers.current.get(id)?.owner === owner)
              contributedLayers.current.delete(id);
            changed();
          },
          onExtension(kind, value) {
            if (!current()) return;
            if (
              value &&
              typeof value === "object" &&
              contributedLayers.current.has(
                String((value as { id?: unknown }).id),
              )
            )
              throw new Error("扩展ID重复");
            registry.current.register(owner, kind, value);
            changed();
          },
          onExtensionRemoved(id) {
            if (current()) {
              registry.current.remove(owner, id);
              changed();
            }
          },
          async onData(product, time, signal) {
            if (!current()) throw new Error("插件已卸载");
            const r = await sessionFetch(
              `/api/scenes/${encodeURIComponent(scene.id)}/plugins/data?${new URLSearchParams({ productId: product, time })}`,
              { signal },
            );
            if (!r.ok) throw new Error("授权产品读取失败");
            return r.json();
          },
          onMap(action, args) {
            if (!current()) return;
            const facade = mapRef.current;
            if (
              action === "flyTo" &&
              typeof args[0] === "number" &&
              typeof args[1] === "number" &&
              Number.isFinite(args[0]) &&
              Number.isFinite(args[1]) &&
              Math.abs(args[0]) <= 180 &&
              Math.abs(args[1]) <= 90
            )
              facade?.flyTo(
                args[0],
                args[1],
                typeof args[2] === "number" && Number.isFinite(args[2])
                  ? Math.max(100, Math.min(10000000, args[2]))
                  : undefined,
              );
            else if (
              action === "zoom" &&
              typeof args[0] === "number" &&
              args[0] >= 0.1 &&
              args[0] <= 10
            )
              facade?.zoom(args[0]);
            else if (action === "north") facade?.north();
          },
          onEvent(name, payload) {
            if (current())
              window.dispatchEvent(
                new CustomEvent(`dtv:${name}`, { detail: payload }),
              );
          },
          onError(message) {
            if (current()) setError(message);
          },
          onDisposed() {
            if (!current()) return;
            registry.current.removeOwner(owner);
            popups.current.delete(owner);
            for (const [id, entry] of contributedLayers.current)
              if (entry.owner === owner) contributedLayers.current.delete(id);
            changed();
          },
        },
        { id: scene.id, center: scene.center },
      );
      if (!current()) {
        await handle.unload();
        return;
      }
      handles.current.set(owner, handle);
      setInstalledIds([...handles.current.keys()]);
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setBusy(false);
    }
  }
  const resolveFrame = useCallback(
    async (
      id: string,
      time: string,
      signal: AbortSignal,
    ): Promise<DataFrame | null> => {
      const provider = registry.current.providers().find((p) => p.id === id);
      if (!provider) {
        if (contributedLayers.current.has(id))
          throw new Error("自定义图层需注册站点Provider");
        return null;
      }
      const owner = registry.current.owner(id),
        handle = owner ? handles.current.get(owner) : undefined;
      if (!handle) throw new Error("站点Provider尚未就绪或已卸载");
      const value = await handle.queryProvider(id, time, signal);
      if (
        signal.aborted ||
        registry.current.owner(id) !== owner ||
        handles.current.get(owner!) !== handle
      )
        throw new Error("站点Provider已取消");
      return parseProviderFrame(value, provider.source, time);
    },
    [],
  );
  const contributions = useMemo(() => {
    const providers = registry.current.providers();
    return {
      routes: registry.current.routes(),
      widgets: registry.current.widgets(),
      layers: [...contributedLayers.current.values()]
        .map((v) => v.layer)
        .concat(
          providers.map((p) => ({
            id: p.id,
            name: p.name,
            category: "station" as const,
            tag: `插件 · ${p.source}`,
            datasetKey: p.datasetKey,
            valueField: p.element,
            rendererType: "grid" as const,
            opacitySupported: true,
            defaultOpacity: 0.8,
            unit: p.unit,
            available: true,
          })),
        ),
      popup: [...popups.current.values()].at(-1) ?? null,
    };
    // 注册表只在消息注册/清理时改变，由revision发布快照。
  }, [revision]);
  return {
    ...contributions,
    resolveFrame,
    plugins,
    selected,
    selectedId,
    setSelectedId,
    installed,
    busy,
    discovering,
    error,
    toggle,
  };
}
