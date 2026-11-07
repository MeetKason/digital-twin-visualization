import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useEffect,
  useState,
} from "react";
import type {
  SceneConfig,
  LayerDescriptor,
  Station,
  DataFrame,
} from "@dtv/contracts";
import { DEMO_TIMES } from "@dtv/contracts";
import type { LayerRuntime, MapFacade } from "@dtv/sdk";
import { api } from "./api";
import { Icon } from "./Icon";
import { LayerPanel } from "./LayerPanel";
import { Timeline } from "./Timeline";
import { useExtensions } from "./useExtensions";
const MapView = lazy(() => import("./MapView"));
const navigation = [
  ["home", "总览地图"],
  ["roam", "路径漫游"],
  ["station", "点位管理"],
  ["weather", "气象专题"],
  ["device", "设备监控"],
  ["settings", "系统管理"],
];
export default function Workbench({ onExit }: { onExit: () => void }) {
  const [scenes, setScenes] = useState<SceneConfig[]>([]),
    [sceneId, setSceneId] = useState("xian"),
    [error, setError] = useState(""),
    [now, setNow] = useState(new Date());
  useEffect(() => {
    const ctrl = new AbortController();
    void api
      .scenes(ctrl.signal)
      .then(setScenes)
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
          <span className="demo-badge">演示环境</span>
          <select
            aria-label="地区场景"
            value={sceneId}
            onChange={(e) => setSceneId(e.target.value)}
          >
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}场景
              </option>
            ))}
          </select>
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
          <span>demo</span>
          <button className="exit" onClick={onExit}>
            退出
          </button>
        </div>
      </header>
      {error ? (
        <div role="alert" className="loading-screen">
          场景加载失败：{error}
          <button onClick={() => window.location.reload()}>重试</button>
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
    [index, setIndex] = useState(12),
    [playing, setPlaying] = useState(false),
    [station, setStation] = useState<Station | null>(null),
    [activeMenu, setActiveMenu] = useState("home"),
    [mode, setMode] = useState<"2d" | "3d">("3d");
  const extension = useExtensions(map);
  const allLayers = useMemo(
    () => [...layers, ...extension.layers],
    [layers, extension.layers],
  );
  const time = DEMO_TIMES[index];
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
    if (!playing) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % DEMO_TIMES.length),
      1600,
    );
    return () => clearInterval(timer);
  }, [playing]);
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
          <button
            key={id}
            className={activeMenu === id ? "active" : ""}
            onClick={() => setActiveMenu(id)}
          >
            <Icon name={id} />
            <span>{label}</span>
          </button>
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
              stations={stations}
              time={time}
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
        <div className="time-context">
          {scene.name} · 气象图层
          <span />
          {time.slice(0, 10)} {time.slice(11, 16)}
          <span className="context-mock">示例数据</span>
        </div>
        <aside className="map-toolbar" aria-label="地图工具">
          <button
            aria-label="打开图层面板"
            className={panelOpen ? "active" : ""}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <Icon name="layers" size={20} />
            <span>图层</span>
          </button>
          <button
            aria-label="工具箱"
            className={toolsOpen ? "active" : ""}
            onClick={() => setToolsOpen((v) => !v)}
          >
            <Icon name="tools" size={20} />
            <span>工具箱</span>
          </button>
          <button onClick={() => map?.north()}>
            <Icon name="north" size={20} />
            <span>指北</span>
          </button>
          <button onClick={() => map?.zoom(0.6)}>
            <Icon name="plus" size={20} />
            <span>放大</span>
          </button>
          <button onClick={() => map?.zoom(1.4)}>
            <Icon name="minus" size={20} />
            <span>缩小</span>
          </button>
          <button
            onClick={() => void document.documentElement.requestFullscreen?.()}
          >
            <Icon name="fullscreen" size={20} />
            <span>全屏</span>
          </button>
          <button onClick={() => map?.flyTo(...scene.center, scene.height)}>
            <Icon name="locate" size={20} />
            <span>定位</span>
          </button>
        </aside>
        {panelOpen && (
          <LayerPanel
            layers={allLayers}
            runtime={runtime}
            map={map}
            sceneId={scene.id}
            onClose={() => setPanelOpen(false)}
            onStation={pickStation}
          />
        )}
        <button
          className="map-mode"
          onClick={() => {
            const next = mode === "3d" ? "2d" : "3d";
            setMode(next);
            map?.setMode(next);
          }}
        >
          {mode === "3d" ? "二维视图" : "三维视图"}
        </button>
        {toolsOpen && (
          <section className="tool-panel panel">
            <div className="panel-heading">
              <strong>地图工具箱</strong>
              <button className="mini" onClick={() => setToolsOpen(false)}>
                关闭 ×
              </button>
            </div>
            <div className="panel-body">
              <p>经纬度定位</p>
              <p className="muted">
                在图层搜索框输入“经度,纬度”，例如 {scene.center.join(",")}。
              </p>
              <button
                onClick={() => {
                  setPanelOpen(true);
                  setToolsOpen(false);
                }}
              >
                打开坐标搜索
              </button>
              <p className="muted">
                测距、测面与环境模拟将在后续阶段接入；当前不提供模拟测量结果。
              </p>
            </div>
          </section>
        )}
        {station && (
          <StationDetails
            station={station}
            extension={extension}
            time={time}
            onClose={() => setStation(null)}
          />
        )}
        <ModulePanel
          menu={activeMenu}
          stations={stations}
          onStation={(s) => {
            setStation(s);
            map?.flyTo(s.lon, s.lat);
          }}
          onClose={() => setActiveMenu("home")}
        />
        <div className="map-legend">
          <strong>气象示例色标</strong>
          <div className="legend-gradient" />
          <div>
            <span>低</span>
            <span>示意分布，非分析产品</span>
            <span>高</span>
          </div>
        </div>
        <Timeline
          times={DEMO_TIMES}
          index={index}
          onIndex={manualIndex}
          playing={playing}
          onPlaying={setPlaying}
        />
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
  return (
    <section className="station-details panel">
      <div className="panel-heading">
        <strong>站点观测详情</strong>
        <button className="mini" aria-label="关闭站点详情" onClick={onClose}>
          关闭 ×
        </button>
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
          <dd>{time.slice(0, 16).replace("T", " ")} UTC+8</dd>
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
        <button
          disabled={extension.busy}
          onClick={() => void extension.toggle()}
        >
          {extension.busy
            ? "正在处理…"
            : extension.installed
              ? "卸载示例插件"
              : "加载示例插件"}
        </button>
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
function ModulePanel({
  menu,
  stations,
  onStation,
  onClose,
}: {
  menu: string;
  stations: Station[];
  onStation: (s: Station) => void;
  onClose: () => void;
}) {
  if (menu === "home") return null;
  const title = navigation.find(([id]) => id === menu)?.[1];
  return (
    <section className="module-panel panel">
      <div className="panel-heading">
        <strong>{title}</strong>
        <button className="mini" onClick={onClose}>
          返回地图 ×
        </button>
      </div>
      <div className="panel-body">
        {menu === "station" ? (
          <>
            <p className="muted">当前地区示例站点 · 只读浏览</p>
            {stations.map((s) => (
              <button
                className="search-result"
                key={s.id}
                onClick={() => onStation(s)}
              >
                {s.name}
                <small>{s.id}</small>
              </button>
            ))}
          </>
        ) : (
          <>
            <span className="tag">建设中</span>
            <h2>{title}</h2>
            <p className="muted">
              {menu === "roam"
                ? "后续接入方案库、逐点环绕、转场和播放控制。"
                : menu === "weather"
                  ? "当前可在图层面板体验气温与降水示例；正式专题指标需确认数据与算法。"
                  : menu === "device"
                    ? "设备协议、视频与采集运行监控需现场接入。"
                    : "当前提供三个地区场景配置。正式账号、角色、租户与审计将在服务端认证阶段实现。"}
            </p>
            <p className="data-disclaimer">
              此入口用于标明建设范围，尚未提供完整业务能力。
            </p>
          </>
        )}
      </div>
    </section>
  );
}
