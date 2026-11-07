import type { LayerDescriptor } from "@dtv/contracts";
export interface LayerHandle {
  setOpacity(value: number): void;
  setTime(time: string): void | Promise<void>;
  dispose(): void;
}
export type LayerStatus = "off" | "loading" | "on" | "error";
export interface LayerState {
  status: LayerStatus;
  opacity: number;
  error?: string;
}
export class LayerRuntime {
  private states = new Map<string, LayerState>();
  private generations = new Map<string, number>();
  private handles = new Map<string, LayerHandle>();
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(
    private factory: (id: string, signal: AbortSignal) => Promise<LayerHandle>,
  ) {}
  private controllers = new Map<string, AbortController>();
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  snapshot(id: string): LayerState {
    return this.states.get(id) ?? { status: "off", opacity: 0.8 };
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  async toggle(id: string, visible: boolean) {
    if (this.disposed) return;
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    this.handles.get(id)?.dispose();
    this.handles.delete(id);
    const opacity = this.snapshot(id).opacity;
    this.states.set(id, { status: visible ? "loading" : "off", opacity });
    this.emit();
    if (!visible) return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      const handle = await this.factory(id, controller.signal);
      if (this.disposed || this.generations.get(id) !== generation) {
        handle.dispose();
        return;
      }
      const latestOpacity = this.snapshot(id).opacity;
      handle.setOpacity(latestOpacity);
      this.handles.set(id, handle);
      this.states.set(id, { status: "on", opacity: latestOpacity });
    } catch (error) {
      if (this.generations.get(id) === generation && !this.disposed)
        this.states.set(id, {
          status: "error",
          opacity,
          error: error instanceof Error ? error.message : "图层加载失败",
        });
    }
    this.emit();
  }
  setOpacity(id: string, value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("透明度应为 0–1");
    this.states.set(id, { ...this.snapshot(id), opacity: value });
    this.handles.get(id)?.setOpacity(value);
    this.emit();
  }
  async setTime(time: string) {
    await Promise.all(
      [...this.handles.values()].map((handle) => handle.setTime(time)),
    );
  }
  dispose() {
    this.disposed = true;
    this.controllers.forEach((c) => c.abort());
    this.handles.forEach((h) => h.dispose());
    this.handles.clear();
    this.controllers.clear();
    this.states.clear();
    this.emit();
    this.listeners.clear();
  }
}
export interface MapFacade {
  flyTo(lon: number, lat: number, height?: number): void;
  zoom(factor: number): void;
  north(): void;
  setMode(mode: "2d" | "3d"): void;
}
export interface PlatformContext {
  apiVersion: string;
  map: MapFacade;
  layers: { register(layer: LayerDescriptor): () => void };
  slots: { register(id: string, value: unknown): () => void };
  events: { emit(name: string, payload: unknown): void };
}
export interface PlatformPlugin {
  manifest: { id: string; version: string; coreApi: number };
  activate(ctx: PlatformContext): Promise<() => void | Promise<void>>;
}
export class PluginManager {
  private installing = new Set<string>();
  private installed = new Map<string, () => void | Promise<void>>();
  constructor(private ctx: PlatformContext) {}
  ids() {
    return [...this.installed.keys()];
  }
  async install(plugin: PlatformPlugin) {
    if (plugin.manifest.coreApi !== Number(this.ctx.apiVersion.split(".")[0]))
      throw new Error("SDK 版本不兼容");
    if (
      this.installed.has(plugin.manifest.id) ||
      this.installing.has(plugin.manifest.id)
    )
      throw new Error("插件已安装");
    this.installing.add(plugin.manifest.id);
    try {
      const cleanup = await plugin.activate(this.ctx);
      this.installed.set(plugin.manifest.id, cleanup);
    } finally {
      this.installing.delete(plugin.manifest.id);
    }
  }
  async uninstall(id: string) {
    await this.installed.get(id)?.();
    this.installed.delete(id);
  }
}
