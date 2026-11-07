import { useEffect, useRef, useState } from "react";
import type { LayerDescriptor } from "@dtv/contracts";
import { PluginManager, type MapFacade, type PlatformPlugin } from "@dtv/sdk";
export interface PopupExtension {
  label: string;
  description: string;
}
export function useExtensions(map: MapFacade | null) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const alive = useRef(true);
  const [layers, setLayers] = useState<LayerDescriptor[]>([]),
    [popup, setPopup] = useState<PopupExtension | null>(null),
    [installed, setInstalled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const managerRef = useRef<PluginManager | null>(null);
  if (!managerRef.current)
    managerRef.current = new PluginManager({
      apiVersion: "1.0.0",
      map: {
        flyTo: (...args) => mapRef.current?.flyTo(...args),
        zoom: (x) => mapRef.current?.zoom(x),
        north: () => mapRef.current?.north(),
        setMode: (x) => mapRef.current?.setMode(x),
      },
      layers: {
        register: (layer) => {
          setLayers((old) => [...old.filter((l) => l.id !== layer.id), layer]);
          return () => {
            if (alive.current)
              setLayers((old) => old.filter((l) => l.id !== layer.id));
          };
        },
      },
      slots: {
        register: (id, value) => {
          if (id !== "station.popup.footer")
            throw new Error("当前宿主不支持此插槽");
          const v = value as PopupExtension;
          if (
            typeof v?.label !== "string" ||
            typeof v?.description !== "string"
          )
            throw new Error("插槽数据格式错误");
          setPopup(v);
          return () => {
            if (alive.current) setPopup(null);
          };
        },
      },
      events: {
        emit: (name, payload) =>
          window.dispatchEvent(
            new CustomEvent(`dtv:${name}`, { detail: payload }),
          ),
      },
    });
  useEffect(() => {
    alive.current = true;
    const manager = managerRef.current;
    return () => {
      alive.current = false;
      void manager?.uninstall("example.station-popup");
    };
  }, []);
  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError("");
    const manager = managerRef.current!;
    try {
      if (installed) {
        await manager.uninstall("example.station-popup");
        if (alive.current) setInstalled(false);
      } else {
        // Only the application-owned, same-origin example is allowed here. This is not an arbitrary URL loader.
        const response = await fetch("/extensions/example/manifest.json");
        if (!response.ok) throw new Error("示例插件清单不可用");
        const manifest = await response.json();
        if (
          manifest.id !== "example.station-popup" ||
          manifest.entry !== "/extensions/example/index.js" ||
          manifest.coreApi !== 1
        )
          throw new Error("示例插件清单不兼容");
        const entry = new URL(manifest.entry, window.location.origin).href;
        const module = (await import(/* @vite-ignore */ entry)) as {
          default: PlatformPlugin;
        };
        if (!alive.current) return;
        await manager.install(module.default);
        if (!alive.current) {
          await manager.uninstall("example.station-popup");
          return;
        }
        setInstalled(true);
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "插件加载失败");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return { layers, popup, installed, busy, error, toggle };
}
