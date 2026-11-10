import { UiButton, UiSelect } from "./ui/controls";
import { Alert } from "antd";
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useEffect,
  useState,
  useRef,
  type PointerEvent,
} from "react";
import type {
  SceneConfig,
  LayerDescriptor,
  Station,
  DataFrame,
} from "@dtv/contracts";

import type { LayerRuntime, MapFacade } from "@dtv/sdk";
import { api, authApi, type SessionUser } from "./api";
import { Icon } from "./Icon";
import { LayerPanel } from "./LayerPanel";
import { Timeline } from "./Timeline";
import { useExtensions } from "./useExtensions";
import { useBusiness } from "./business/useBusiness";
import {
  ToolsPanel,
  EnvironmentOverlay,
  type Environment,
} from "./business/ToolsPanel";
import { CruisePanel } from "./business/CruisePanel";
import { StationPage } from "./business/StationPage";
import { WeatherPage } from "./business/WeatherPage";
import { beijingTime } from "./time";
import { readFile } from "./business/files";
const MapView = lazy(() => import("./MapView"));
const SettingsPage = lazy(() =>
  import("./business/SettingsPage").then((module) => ({
    default: module.SettingsPage,
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
];
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
  // 场景列表由 API 按当前会话授权过滤；组件卸载时中止尚未完成的请求。
  useEffect(() => {
    const ctrl = new AbortController();
    void api
      .scenes(ctrl.signal)
      .then((list) => {
        setScenes(list);
        setSceneId((current) =>
          list.some((s) => s.id === current) ? current : (list[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
    return () => ctrl.abort();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const scene = scenes.find((s) => s.id === sceneId);
  return (
    <div className="application">
      <header>
        <div className="brand">
          <div className="region-logo">{scene?.shortName ?? "孪生"}</div>
          <div>
            <h1>{scene?.name ?? ""}数字孪生可视化系统</h1>
            <p>Digital Twin Visualization</p>
          </div>
        </div>
        <div className="header-right">
          <span className="demo-badge">
            {profile?.kind === "demo" ? "隔离演示租户" : "服务端会话"}
          </span>
          <UiSelect
            aria-label="地区场景"
            value={sceneId}
            onChange={(e) => setSceneId(e.target.value)}
          >
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}场景
              </option>
            ))}
          </UiSelect>
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
          <Icon name="user" />
          <span>{profile?.kind === "demo" ? "演示用户" : profile?.id}</span>
          <UiButton className="exit" onClick={onExit}>
            退出
          </UiButton>
        </div>
      </header>
      {error ? (
        <div role="alert" className="loading-screen">
          场景加载失败：{error}
          <UiButton onClick={() => window.location.reload()}>重试</UiButton>
        </div>
      ) : scene ? (
        <WorkArea key={scene.id} scene={scene} />
      ) : (
        <div className="loading-screen">正在读取场景…</div>
      )}
    </div>
  );
}
function WorkArea({ scene }: { scene: SceneConfig }) {
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
    [activeMenu, setActiveMenu] = useState("home");
  const business = useBusiness(scene.id);
  const managedStations = useMemo(
    () => (business.data.stations.length ? business.data.stations : stations),
    [business.data.stations, stations],
  );
  const [modelError, setModelError] = useState("");
  const [environment, setEnvironment] = useState<Environment>("none");
  const extension = useExtensions(map);
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
  }, [scene.id]);
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
        {navigation.map(([id, label]) => (
          <UiButton
            key={id}
            className={activeMenu === id ? "active" : ""}
            onClick={() => setActiveMenu(id)}
          >
            <Icon name={id} active={activeMenu === id} />
            <span>{label}</span>
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
            fallback={<div className="loading-screen">正在载入三维引擎…</div>}
          >
            <MapView
              scene={scene}
              layers={allLayers}
              stations={managedStations}
              time={time}
              dataRevision={dataRevision}
              onReady={ready}
              onStation={pickStation}
            />
          </Suspense>
        ) : (
          <div
            role={loadState === "error" ? "alert" : "status"}
            className="loading-screen"
          >
            {loadState === "error"
              ? `数据加载失败：${loadError}`
              : "正在读取场景图层…"}
          </div>
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
            onRoam={() => setActiveMenu("roam")}
          />
        )}
        <EnvironmentOverlay value={environment} />
        {station && activeMenu === "home" && (
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
          />
        )}
        {activeMenu === "device" && (
          <Suspense fallback={<p className="muted">正在加载设备监控…</p>}>
            <DevicePage sceneId={scene.id} />
          </Suspense>
        )}
        {activeMenu === "settings" && (
          <Suspense fallback={<p className="muted">正在加载系统设置…</p>}>
            <SettingsPage business={business} onDataChanged={onDataChanged} />
          </Suspense>
        )}
        <div className="workbench-alerts">
          {modelError && <Alert type="error" showIcon message={modelError} />}
          {timesError && <Alert type="warning" showIcon message={`时次读取失败：${timesError}`} />}
          {business.error && <Alert type="error" showIcon message={business.error} />}
        </div>
        <div className="business-sync">
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
        </div>

        <div className="map-legend" hidden={activeMenu !== "home"}>
          <strong>气温 °C · 示例色标</strong>
          <div className="legend-gradient" />
          <strong>1 小时降水 mm · 示例色标</strong>
          <div className="legend-gradient rainfall" />
          <div>
            <span>低</span>
            <span>示意分布，非分析产品</span>
            <span>高</span>
          </div>
        </div>
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
        <span className="tag">Mock 示例站点</span>
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
          <dd>{beijingTime(time)} UTC+8</dd>
          <dt>经纬度</dt>
          <dd>
            {station.lon.toFixed(4)}, {station.lat.toFixed(4)}
          </dd>
          <dt>示例高程</dt>
          <dd>{station.elevationM} m</dd>
          <dt>数据质量</dt>
          <dd>{frame ? "演示资料，不用于业务研判" : error || "加载中…"}</dd>
        </dl>
        <p className="data-disclaimer">
          模型、视频、附件和正式档案将在站点管理阶段接入。
        </p>
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
