import { TenantAuthorization } from "./business/TenantAuthorization";
import { PluginPage, PluginWidgets } from "./business/PluginPanels";
import { WeatherLegend } from "./WeatherLegend";
import { UiButton, UiSelect } from "./ui/controls";
import { Alert, Button, ConfigProvider, Dropdown, Empty } from "antd";
import { DownOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import { MenuIds, ProductModules, type ProductModule } from "@dtv/contracts";
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useEffect,
  useState,
  useRef,
  type PointerEvent,
  type CSSProperties,
} from "react";
import type {
  SceneConfig,
  LayerDescriptor,
  Station,
  DataFrame,
} from "@dtv/contracts";

import type { LayerRuntime, MapFacade } from "@dtv/sdk";
import { api, authApi, authorizationApi, type SessionUser } from "./api";
import { Icon } from "./Icon";
import { LayerPanel } from "./LayerPanel";
import { Timeline } from "./Timeline";
import { MapLoadingPreview } from "./MapLoadingPreview";
import { useExtensions } from "./useExtensions";
import { useBusiness } from "./business/useBusiness";
import {
  ToolsPanel,
  type Environment,
} from "./business/ToolsPanel";
import { CruisePanel } from "./business/CruisePanel";
import { StationPage } from "./business/StationPage";
import { WeatherPage } from "./business/WeatherPage";
import { beijingTime } from "./time";
import { readFile } from "./business/files";
// 登录进入工作台后立即并行下载 Cesium 地图包，不等场景 API 全部返回才开始。
const loadMapView = () => import("./MapView");
const MapView = lazy(loadMapView);
const SettingsPage = lazy(() =>
  import("./business/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const ScenarioManager = lazy(() =>
  import("./business/ScenarioManager").then((module) => ({
    default: module.ScenarioManager,
  })),
);
const DevicePage = lazy(() =>
  import("./business/SettingsPage").then((module) => ({
    default: module.DevicePage,
  })),
);
const navigation = [
  ["home", "总览地图"],
  ["roam", "路径漫游"],
  ["station", "点位管理"],
  ["weather", "气象专题"],
  ["device", "设备监控"],
  ["settings", "系统管理"],
] as const;
export default function Workbench({ onExit }: { onExit: () => void }) {
  const [profile, setProfile] = useState<SessionUser | null>(null);
  // 恢复服务端会话资料，用于显示真实账号或隔离演示会话标识。
  useEffect(() => {
    void authApi
      .session()
      .then((s) => setProfile(s.user))
      .catch(() => {});
  }, []);
  const [scenes, setScenes] = useState<SceneConfig[]>([]),
    [sceneId, setSceneId] = useState("xian"),
    [error, setError] = useState(""),
    [now, setNow] = useState(new Date());
  const [modules, setModules] = useState<ProductModule[]>([...ProductModules]);
  const [authorizationRevision, setAuthorizationRevision] = useState(0);
  const [scenesLoaded, setScenesLoaded] = useState(false);
  const mounted = useRef(true),
    switching = useRef<AbortController | null>(null);
  useEffect(() => {
    // React.lazy 和预加载共用同一动态模块请求，避免场景数据加载后的瀑布式等待。
    void loadMapView().catch(() => undefined);
  }, []);
  const refreshScenes = useCallback(async (signal?: AbortSignal) => {
    const [list, grant] = await Promise.all([
      api.scenes(signal),
      authorizationApi.current(signal),
    ]);
    if (!signal?.aborted && mounted.current) {
      setModules(grant.modules);
      setAuthorizationRevision(grant.revision);
    }
    if (signal?.aborted || !mounted.current) return;
    // 未变化的地区复用对象，发布其他地区时不重建当前Cesium实例。
    setScenes((previous) =>
      list.map(
        (next) =>
          previous.find(
            (item) =>
              item.id === next.id &&
              JSON.stringify(item) === JSON.stringify(next),
          ) ?? next,
      ),
    );
    setSceneId((current) =>
      list.some((item) => item.id === current) ? current : (list[0]?.id ?? ""),
    );
    setError("");
    setScenesLoaded(true);
    return list;
  }, []);
  const sceneApplied = useCallback(async () => {
    await refreshScenes();
  }, [refreshScenes]);
  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();
    void refreshScenes(ctrl.signal).catch((e: Error) => {
      if (!ctrl.signal.aborted) setError(e.message);
    });
    return () => {
      mounted.current = false;
      ctrl.abort();
      switching.current?.abort();
    };
  }, [refreshScenes]);
  async function chooseScene(id: string) {
    switching.current?.abort();
    const controller = new AbortController();
    switching.current = controller;
    try {
      const list = await refreshScenes(controller.signal);
      if (!controller.signal.aborted && list?.some((item) => item.id === id))
        setSceneId(id);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const scene = scenes.find((s) => s.id === sceneId);
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        token: {
          colorPrimary: scene?.ui?.theme.primary ?? "#1263c4",
          borderRadius: 4,
        },
      }}
    >
      <div
        className="application"
        style={
          {
            "--primary": scene?.ui?.theme.primary ?? "#1263c4",
            "--navy": scene?.ui?.theme.navy ?? "#1c466c",
            "--scene-panel-width": `${scene?.ui?.layout.panelWidth ?? 264}px`,
            "--scene-timeline-height": `${scene?.ui?.layout.timelineHeight ?? 112}px`,
          } as CSSProperties
        }
      >
        <header>
          <div className="brand">
            <div className="region-logo" title={scene?.shortName}>
              <span>{scene?.shortName ?? "孪生"}</span>
            </div>
            <div>
              <h1>{scene?.name ?? ""}数字孪生可视化系统</h1>
              <p>Digital Twin Visualization</p>
            </div>
          </div>
          <div className="header-right">
            {profile?.kind === "demo" && (
              <span className="demo-badge">隔离演示租户</span>
            )}
            {scenes.length > 1 && (
              <UiSelect
                aria-label="地区场景"
                value={sceneId}
                onChange={(e) => void chooseScene(e.target.value)}
              >
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}场景
                  </option>
                ))}
              </UiSelect>
            )}
            <time>
              {now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })}{" "}
              <b>
                {now.toLocaleTimeString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  hour12: false,
                })}
              </b>
            </time>
            <span className="header-divider" />
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{
                items: [{ key: "logout", label: "退出" }],
                onClick: ({ key }) => { if (key === "logout") onExit(); },
              }}
            >
              <Button className="account-menu-trigger" type="text" aria-label="打开账号菜单">
                <Icon name="user" />
                <span>{profile?.kind === "demo" ? "演示用户" : profile?.id}</span>
                <DownOutlined />
              </Button>
            </Dropdown>
          </div>
        </header>
        {error ? (
          <div role="alert" className="loading-screen">
            场景加载失败：{error}
            <UiButton onClick={() => window.location.reload()}>重试</UiButton>
          </div>
        ) : scene ? (
          <WorkArea
            key={`${scene.id}:${authorizationRevision}`}
            scene={scene}
            modules={modules}
            onSceneApplied={sceneApplied}
          />
        ) : scenesLoaded ? (
          <div className="no-scene-configuration">
            <Empty description="当前账号暂无已发布场景" />
            <TenantAuthorization onApplied={sceneApplied} />
            {profile?.role === "admin" && profile.scenes[0] && (
              <Suspense fallback={<p>正在加载场景配置…</p>}>
                <ScenarioManager
                  sceneId={profile.scenes[0]}
                  onApplied={sceneApplied}
                  businessSaving={false}
                />
              </Suspense>
            )}
          </div>
        ) : (
          <div className="loading-screen">正在读取场景…</div>
        )}
      </div>
    </ConfigProvider>
  );
}
function WorkArea({
  scene,
  modules,
  onSceneApplied,
}: {
  scene: SceneConfig;
  modules: ProductModule[];
  onSceneApplied: () => Promise<void>;
}) {
  const [layers, setLayers] = useState<LayerDescriptor[]>([]),
    [stations, setStations] = useState<Station[]>([]),
    [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
      "loading",
    ),
    [loadError, setLoadError] = useState("");
  const [runtime, setRuntime] = useState<LayerRuntime | null>(null),
    [map, setMap] = useState<MapFacade | null>(null),
    [panelOpen, setPanelOpen] = useState(true),
    [toolsOpen, setToolsOpen] = useState(false),
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [station, setStation] = useState<Station | null>(null),
    [activeMenu, setActiveMenu] = useState<string>("home");
  const allowedMenus = scene.ui?.menus ?? MenuIds;
  const navigate = (id: string) => {
    if ((allowedMenus as readonly string[]).includes(id)) setActiveMenu(id);
  };

  const [frames, setFrames] = useState<Record<string, DataFrame>>({});
  const receiveFrame = useCallback(
    (id: string, frame: DataFrame) =>
      setFrames((previous) => ({ ...previous, [id]: frame })),
    [],
  );
  const business = useBusiness(scene.id);
  const managedStations = useMemo(
    () => (business.data.stations.length ? business.data.stations : stations),
    [business.data.stations, stations],
  );
  const [modelError, setModelError] = useState("");
  const [environment, setEnvironment] = useState<Environment>("none");
  useEffect(() => {
    map?.setEnvironment?.(environment);
    return () => map?.setEnvironment?.("none");
  }, [map, environment]);
  const extension = useExtensions(map, scene, modules.includes("plugins"));
  useEffect(() => {
    if (
      !(allowedMenus as readonly string[]).includes(activeMenu) &&
      !extension.routes.some((route) => route.id === activeMenu)
    )
      setActiveMenu("home");
  }, [allowedMenus, activeMenu, extension.routes]);
  useEffect(() => {
    setPlaying(false);
    setEnvironment("none");
  }, [activeMenu]);
  useEffect(() => {
    if (!map?.placeModel) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    for (const station of business.data.stations) {
      const asset = business.data.assets.find((a) => a.id === station.modelId);
      if (!asset) continue;
      void readFile(scene.id, asset.blobId)
        .then((blob) => {
          if (disposed) return;
          const url = URL.createObjectURL(blob);
          const remove = map.placeModel?.(
            url,
            station.lon,
            station.lat,
            station.elevationM,
            asset.scale ?? 1,
            asset.heading ?? 0,
          );
          cleanups.push(() => {
            remove?.();
            URL.revokeObjectURL(url);
          });
        })
        .catch(() => {
          if (!disposed)
            setModelError(`模型 ${asset.name} 的本地文件不可用，请重新上传`);
        });
    }
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [map, business.data.stations, business.data.assets, scene.id]);
  const allLayers = useMemo(
    () => [...layers, ...extension.layers],
    [layers, extension.layers],
  );
  const signature = useRef(""),
    refreshNeeded = useRef(true),
    selectedTime = useRef(""),
    refreshing = useRef<AbortController | null>(null);
  const [dataMode, setDataMode] = useState<"demo" | "ingested">("demo");
  const [times, setTimes] = useState<string[]>([]),
    [dataRevision, setDataRevision] = useState(0),
    [timesError, setTimesError] = useState("");
  const onDataChanged = useCallback(() => setDataRevision((r) => r + 1), []);
  const time = times[index] ?? "";
  if (time) selectedTime.current = time;
  useEffect(() => {
    const ctrl = new AbortController();
    refreshNeeded.current = true;
    refreshing.current = ctrl;
    // Read the mode first; a change between requests will be detected by the next status poll.
    void api
      .ingestion(scene.id, ctrl.signal)
      .then(async (state) => {
        const next = await api.times("temperature", scene.id, ctrl.signal);
        return [next, state] as const;
      })
      .then(([next, state]) => {
        if (ctrl.signal.aborted) return;
        refreshNeeded.current = false;
        signature.current = `${state.mode}:${state.watermark}:${state.lastSuccessAt}`;
        setDataMode(state.mode);
        const preserved = next.findIndex(
          (t) => Date.parse(t) === Date.parse(selectedTime.current),
        );
        setTimes(next);
        setIndex((i) =>
          preserved >= 0
            ? preserved
            : Math.max(0, Math.min(i, next.length - 1)),
        );
        setTimesError("");
        if (dataRevision === 0) setIndex(Math.max(0, next.length - 1));
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setTimes([]);
          setIndex(0);
          setTimesError(e.message);
        }
      })
      .finally(() => {
        if (refreshing.current === ctrl) refreshing.current = null;
      });
    return () => {
      ctrl.abort();
      if (refreshing.current === ctrl) refreshing.current = null;
    };
  }, [scene.id, dataRevision]);
  useEffect(() => {
    const ctrl = new AbortController();
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (ctrl.signal.aborted || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (pending || refreshing.current || ctrl.signal.aborted) {
        schedule(refreshNeeded.current ? 3000 : 30000);
        return;
      }
      pending = true;
      let activeJobs = false;
      try {
        const state = await api.ingestion(scene.id, ctrl.signal);
        if (ctrl.signal.aborted || refreshing.current) return;
        const next = `${state.mode}:${state.watermark}:${state.lastSuccessAt}`;
        activeJobs = state.jobs.some((job) =>
          ["queued", "running", "retrying"].includes(job.status),
        );
        if (
          !signature.current ||
          refreshNeeded.current ||
          next !== signature.current
        )
          onDataChanged();
        else setTimesError("");
      } catch (e) {
        if (!ctrl.signal.aborted)
          setTimesError("采集状态刷新失败：" + (e as Error).message);
        if ((e as Error & { status?: number }).status === 403) ctrl.abort();
      } finally {
        pending = false;
        schedule(refreshNeeded.current ? 3000 : activeJobs ? 5000 : 30000);
      }
    };
    const onVisibilityChange = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === "visible") void poll();
    };
    // 地图空闲时每30秒检查；存在采集任务时保持5秒刷新。
    // 首屏时次读取失败时尽快恢复，正常空闲页面仍保持低频检查。
    schedule(refreshNeeded.current ? 3000 : 30000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [scene.id, onDataChanged]);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoadState("loading");
    setRuntime(null);
    setMap(null);
    void Promise.all([
      api.layers(scene.id, ctrl.signal),
      api.stations(scene.id, ctrl.signal),
    ])
      .then(([l, s]) => {
        setLayers(l);
        setStations(s);
        setLoadState("ready");
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setLoadError(e.message);
          setLoadState("error");
        }
      });
    return () => ctrl.abort();
  }, [scene.id, scene.revision]);
  useEffect(() => {
    if (!playing || !times.length) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % times.length),
      1600,
    );
    return () => clearInterval(timer);
  }, [playing, times.length]);
  const ready = useCallback((r: LayerRuntime, m: MapFacade) => {
    setRuntime(r);
    setMap(m);
  }, []);
  const pickStation = useCallback((s: Station) => setStation(s), []);
  const manualIndex = (i: number) => {
    setPlaying(false);
    setIndex(i);
  };
  return (
    <div className="workspace">
      <nav className="side-navigation" aria-label="主导航">
        {navigation
          .filter(([id]) => allowedMenus.includes(id))
          .map(([id, label]) => (
            <UiButton
              key={id}
              className={activeMenu === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon name={id} active={activeMenu === id} />
              <span>{label}</span>
            </UiButton>
          ))}
        {extension.routes.map((route) => (
          <UiButton
            key={route.id}
            className={activeMenu === route.id ? "active" : ""}
            onClick={() => setActiveMenu(route.id)}
          >
            <Icon name="settings" />
            <span className="plugin-nav-label" title={route.title}>
              {route.title}
            </span>
          </UiButton>
        ))}
        <div className="navigation-bottom">
          <span className="status-dot" />
          本地演示
        </div>
      </nav>
      <main className="map-workspace">
        {loadState === "ready" ? (
          <Suspense
            fallback={
              <MapLoadingPreview scene={scene} stations={managedStations} />
            }
          >
            <MapView
              resolvePluginFrame={extension.resolveFrame}
              scene={scene}
              layers={allLayers}
              stations={managedStations}
              time={time}
              dataRevision={dataRevision}
              onReady={ready}
              onFrame={receiveFrame}
              onStation={pickStation}
            />
          </Suspense>
        ) : loadState === "error" ? (
          <div
            role="alert"
            className="loading-screen"
          >
            数据加载失败：{loadError}
          </div>
        ) : (
          <MapLoadingPreview
            scene={scene}
            stations={managedStations}
            status="正在读取场景图层"
          />
        )}
        <div className="time-context" hidden={activeMenu !== "home"}>
          {scene.name} · 气象图层
          <span />
          {beijingTime(time)}
          <span className="context-mock">示例数据</span>
        </div>
        <aside
          className="map-toolbar"
          aria-label="地图工具"
          hidden={activeMenu !== "home"}
        >
          <UiButton
            aria-label="打开图层面板"
            className={panelOpen ? "active" : ""}
            onClick={() => {
              setPanelOpen((v) => !v);
              setToolsOpen(false);
            }}
          >
            <Icon name="layers" size={20} />
            <span>图层</span>
          </UiButton>
          <UiButton
            aria-label="工具箱"
            className={toolsOpen ? "active" : ""}
            onClick={() => {
              setToolsOpen((v) => !v);
              setPanelOpen(false);
            }}
          >
            <Icon name="tools" size={20} />
            <span>工具箱</span>
          </UiButton>
          <UiButton onClick={() => map?.north()}>
            <Icon name="north" size={20} />
            <span>指北</span>
          </UiButton>
          <UiButton onClick={() => map?.zoom(0.6)}>
            <Icon name="plus" size={20} />
            <span>放大</span>
          </UiButton>
          <UiButton onClick={() => map?.zoom(1.4)}>
            <Icon name="minus" size={20} />
            <span>缩小</span>
          </UiButton>
          <UiButton
            onClick={() => void document.documentElement.requestFullscreen?.()}
          >
            <Icon name="fullscreen" size={20} />
            <span>全屏</span>
          </UiButton>
          <UiButton onClick={() => map?.flyTo(...scene.center, scene.height)}>
            <Icon name="locate" size={20} />
            <span>定位</span>
          </UiButton>
        </aside>
        <div hidden={!panelOpen || activeMenu !== "home"}>
          <LayerPanel
            layers={allLayers}
            stations={managedStations}
            runtime={runtime}
            map={map}
            sceneId={scene.id}
            onClose={() => setPanelOpen(false)}
            onStation={pickStation}
          />
        </div>
        {toolsOpen && activeMenu === "home" && (
          <ToolsPanel
            map={map}
            business={business}
            environment={environment}
            onEnvironment={setEnvironment}
            onClose={() => setToolsOpen(false)}
            onRoam={() => navigate("roam")}
            allowRoam={allowedMenus.includes("roam")}
          />
        )}
        {activeMenu === "home" && (
          <PluginWidgets widgets={extension.widgets} map={map} />
        )}
        {extension.routes
          .filter((route) => route.id === activeMenu)
          .map((route) => (
            <PluginPage key={route.id} route={route} map={map} />
          ))}
        {station && (activeMenu === "home" || activeMenu === "weather") && (
          <StationDetails
            station={station}
            extension={extension}
            time={time}
            onClose={() => setStation(null)}
          />
        )}
        {activeMenu === "roam" && <CruisePanel business={business} map={map} />}
        {activeMenu === "station" && (
          <StationPage
            business={business}
            map={map}
            sceneId={scene.id}
            time={time}
            allowFiles={modules.includes("files")}
            allowRoam={modules.includes("roam")}
            onMap={() => setActiveMenu("home")}
          />
        )}
        {activeMenu === "weather" && (
          <WeatherPage
            business={business}
            map={map}
            runtime={runtime}
            sceneId={scene.id}
            time={time}
            times={times}
            onStation={pickStation}
          />
        )}
        {activeMenu === "device" && (
          <Suspense fallback={<p className="muted">正在加载设备监控…</p>}>
            <DevicePage sceneId={scene.id} map={map} business={business} onMap={() => setActiveMenu("home")} />
          </Suspense>
        )}
        {activeMenu === "settings" && (
          <Suspense fallback={<p className="muted">正在加载系统设置…</p>}>
            <SettingsPage
              scene={scene}
              business={business}
              modules={modules}
              extension={extension}
              onDataChanged={onDataChanged}
              onSceneApplied={onSceneApplied}
            />
          </Suspense>
        )}
        <div className="workbench-alerts">
          {modelError && <Alert type="error" showIcon message={modelError} />}
          {timesError && (
            <Alert
              type="warning"
              showIcon
              message={`时次读取失败：${timesError}`}
            />
          )}
          {business.error && (
            <Alert type="error" showIcon message={business.error} />
          )}
        </div>
        {(business.error || business.legacy || business.status !== "服务端资料已加载") && <div className="business-sync">
          <span role="status">{business.status}</span>
          {business.error && (
            <UiButton onClick={() => void business.reload()}>
              重新加载服务端资料
            </UiButton>
          )}
          {business.legacy && (
            <UiButton onClick={business.migrateLocal}>
              迁移当前地区的本地演示资料
            </UiButton>
          )}
        </div>}

        <WeatherLegend
          runtime={runtime}
          frames={frames}
          time={time}
          hidden={activeMenu !== "home"}
          onLocate={() => map?.flyTo(...scene.center, scene.height * 0.65)}
        />
        <div hidden={activeMenu !== "home"}>
          <Timeline
            times={times}
            mode={dataMode}
            index={index}
            onIndex={manualIndex}
            playing={playing}
            onPlaying={setPlaying}
          />
        </div>
      </main>
    </div>
  );
}
function StationDetails({
  station,
  time,
  onClose,
  extension,
}: {
  station: Station;
  extension: ReturnType<typeof useExtensions>;
  time: string;
  onClose: () => void;
}) {
  const [frame, setFrame] = useState<DataFrame | null>(null),
    [error, setError] = useState("");
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const dragOrigin = useRef<{
    pointerX: number;
    pointerY: number;
    panelX: number;
    panelY: number;
  } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setFrame(null);
    setError("");
    void api
      .data("stations", station.sceneId, time, ctrl.signal)
      .then(setFrame)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
    return () => ctrl.abort();
  }, [station, time]);
  const observation = frame?.observations.find(
    (o) => o.stationId === station.id,
  );

  // 拖动只操作弹框自身的位置，限制在浏览器可视区域内，避免面板被拖出屏幕。
  const startDragging = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    dragOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      panelX: panel.offsetLeft,
      panelY: panel.offsetTop,
    };
    setPosition({ x: panel.offsetLeft, y: panel.offsetTop });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePanel = (event: PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    const bounds = panel.offsetParent as HTMLElement | null;
    const maxX = Math.max(
      0,
      (bounds?.clientWidth ?? window.innerWidth) - panel.offsetWidth,
    );
    const maxY = Math.max(
      0,
      (bounds?.clientHeight ?? window.innerHeight) - panel.offsetHeight,
    );
    setPosition({
      x: Math.min(
        maxX,
        Math.max(0, origin.panelX + event.clientX - origin.pointerX),
      ),
      y: Math.min(
        maxY,
        Math.max(0, origin.panelY + event.clientY - origin.pointerY),
      ),
    });
  };

  const stopDragging = () => {
    dragOrigin.current = null;
  };

  return (
    <section
      className={`station-details panel${position ? " is-positioned" : ""}`}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <div
        className="panel-heading station-details-heading"
        onPointerDown={startDragging}
        onPointerMove={movePanel}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <strong>站点观测详情</strong>
        <UiButton className="mini" aria-label="关闭站点详情" onClick={onClose}>
          关闭 <Icon name="close" size={14} />
        </UiButton>
      </div>
      <div className="panel-body">
        <h2>{station.name}</h2>
        <p className="station-code">
          {station.id} · {station.type}
        </p>
        <div className="station-metrics">
          <div>
            <span>气温</span>
            <strong>
              {observation?.elements.temperatureC ?? "—"}
              <small> °C</small>
            </strong>
          </div>
          <div>
            <span>1 小时降水</span>
            <strong>
              {observation?.elements.rainfallMm ?? "—"}
              <small> mm</small>
            </strong>
          </div>
        </div>
        <dl>
          <dt>有效时次</dt>
          <dd>{beijingTime(time)}</dd>
          <dt>经纬度</dt>
          <dd>
            {station.lon.toFixed(4)}, {station.lat.toFixed(4)}
          </dd>
          <dt>示例高程</dt>
          <dd>{station.elevationM} m</dd>
          <dt>数据质量</dt>
          <dd>{frame ? "演示资料，不用于业务研判" : error || "加载中…"}</dd>
        </dl>
        {extension.discovering ? (
          <p className="muted">正在发现同源插件…</p>
        ) : extension.plugins.length > 0 ? (
          <>
            <label>
              可安装插件
              <UiSelect
                aria-label="可安装插件"
                value={extension.selectedId}
                onChange={(event) =>
                  extension.setSelectedId(event.target.value)
                }
              >
                {extension.plugins.map((plugin) => (
                  <option key={plugin.id} value={plugin.id}>
                    {plugin.id} · v{plugin.version}
                  </option>
                ))}
              </UiSelect>
            </label>
            <UiButton
              disabled={extension.busy || !extension.selected}
              onClick={() => void extension.toggle()}
            >
              {extension.busy
                ? "正在处理…"
                : extension.installed
                  ? extension.selected?.id === "example.station-popup"
                    ? "卸载示例插件"
                    : `卸载 ${extension.selected?.id}`
                  : extension.selected?.id === "example.station-popup"
                    ? "加载示例插件"
                    : `加载 ${extension.selected?.id}`}
            </UiButton>
          </>
        ) : (
          <p className="muted">未发现可用插件。</p>
        )}
        {extension.popup && (
          <div className="extension-slot">
            <strong>{extension.popup.label}</strong>
            <p>{extension.popup.description}</p>
          </div>
        )}
        {extension.error && (
          <p role="alert" className="error-text">
            {extension.error}
          </p>
        )}
      </div>
    </section>
  );
}
