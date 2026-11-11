import { UiButton, UiInput } from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import type { MapFacade } from "@dtv/sdk";
import { Icon } from "../Icon";
import {
  parseCoordinate,
  distanceMeters,
  areaMeters,
  type Coordinate,
} from "@dtv/contracts";
import type { Business } from "./useBusiness";
import { Modal } from "./Modal";
export type Environment = "none" | "rain" | "snow" | "fog";
export function ToolsPanel({
  map,
  business,
  onClose,
  onRoam,
  allowRoam = true,
  environment,
  onEnvironment,
}: {
  map: MapFacade | null;
  business: Business;
  onClose: () => void;
  onRoam: () => void;
  allowRoam?: boolean;
  environment: Environment;
  onEnvironment: (e: Environment) => void;
}) {
  const [dialog, setDialog] = useState<
      "coordinate" | "save" | "bookmarks" | null
    >(null),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [lon, setLon] = useState(""),
    [lat, setLat] = useState(""),
    [height, setHeight] = useState(""),
    [measurement, setMeasurement] = useState("");
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  function measure(kind: "distance" | "area") {
    cleanup.current?.();
    setMeasurement("在地图单击添加点，右键结束；结果为球面近似值。");
    cleanup.current =
      map?.beginMeasure?.(kind, (points: Coordinate[], done) =>
        setMeasurement(
          `${done ? "测量结束" : "测量中"} · ${points.length} 点 · ${kind === "distance" ? `${(distanceMeters(points) / 1000).toFixed(3)} km` : `${(areaMeters(points) / 1e6).toFixed(3)} km²`}`,
        ),
      ) ?? null;
  }
  const section = (title: string, buttons: [string, () => void][]) => (
    <>
      <h3>{title}</h3>
      <div className="tool-grid">
        {buttons.map(([label, fn]) => (
          <UiButton key={label} onClick={fn} disabled={!map}>
            {label}
          </UiButton>
        ))}
      </div>
    </>
  );
  return (
    <section className="tools-drawer panel">
      <div className="panel-heading">
        <strong>地图工具箱</strong>
        <UiButton className="mini" onClick={onClose}>
          收起 <Icon name="close" size={14} />
        </UiButton>
      </div>
      <div className="panel-body">
        {section("地图基本控制", [
          ["漫游", onRoam],
          ["指北复位", () => map?.north()],
          ["放大", () => map?.zoom(0.6)],
          ["缩小", () => map?.zoom(1.4)],
          ["倾斜", () => map?.tilt?.()],
          ["旋转", () => map?.rotate?.()],
          ["二维视图", () => map?.setMode("2d")],
          ["三维视图", () => map?.setMode("3d")],
        ])}
        {section("空间测量与定位", [
          ["距离测量", () => measure("distance")],
          ["面积测量", () => measure("area")],
          [
            "经纬度定位",
            () => {
              setError("");
              setDialog("coordinate");
            },
          ],
          [
            "坐标/高程拾取",
            () => {
              cleanup.current?.();
              setMeasurement("单击地图拾取坐标");
              cleanup.current =
                map?.pickCoordinate?.((x, y, z) =>
                  setMeasurement(
                    `${x.toFixed(6)}°E / ${y.toFixed(6)}°N · ${z.toFixed(1)} m（当前地形）`,
                  ),
                ) ?? null;
            },
          ],
        ])}
        <p className="tool-hint">
          {measurement ||
            "拖拽地图浏览；滚轮缩放。测量结果仅供演示，当前地形为椭球时高程不能作为实测。"}
        </p>
        {measurement && (
          <UiButton
            onClick={() => {
              cleanup.current?.();
              setMeasurement("");
            }}
          >
            清除测量
          </UiButton>
        )}
        {section("视角与路径", [
          [
            "保存视角",
            () => {
              setName(`视角 ${business.data.bookmarks.length + 1}`);
              setDialog("save");
            },
          ],
          ["历史书签", () => setDialog("bookmarks")],
          ...(allowRoam ? [["自定义路径漫游", onRoam] as [string, () => void]] : []),
        ])}
        <h3>自然环境模拟</h3>
        <div className="tool-grid">
          {(
            [
              ["rain", "雨景模拟"],
              ["snow", "雪景模拟"],
              ["fog", "雾效模拟"],
              ["none", "关闭模拟"],
            ] as const
          ).map(([id, label]) => (
            <UiButton
              key={id}
              className={environment === id ? "active" : ""}
              onClick={() => onEnvironment(id)}
            >
              {label}
            </UiButton>
          ))}
        </div>
        <p className="tool-hint">视觉模拟，不改变观测数据。</p>
      </div>
      {dialog && (
        <Modal
          title={
            dialog === "coordinate"
              ? "经纬度定位"
              : dialog === "save"
                ? "保存当前视角"
                : "历史书签"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "coordinate" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const point = parseCoordinate(lon, lat);
                  const z = height.trim() ? Number(height) : undefined;
                  if (z !== undefined && (!Number.isFinite(z) || z < 0))
                    throw new Error("高程请输入非负数");
                  map?.flyTo(...point, z ?? 20000);
                  setDialog(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <label>
                经度（°）
                <UiInput
                  required
                  value={lon}
                  onChange={(e) => setLon(e.target.value)}
                />
              </label>
              <label>
                纬度（°）
                <UiInput
                  required
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
              </label>
              <label>
                相机高度（m，选填）
                <UiInput
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </label>
              <p className="muted">确认后定位到指定坐标，坐标系 EPSG:4326。</p>
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <UiButton className="primary" type="submit">确定定位</UiButton>
            </form>
          ) : dialog === "save" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const view = map?.captureView?.();
                if (!view || !name.trim()) return;
                business.update((old) => ({
                  ...old,
                  bookmarks: [
                    ...old.bookmarks,
                    { id: crypto.randomUUID(), name: name.trim(), view },
                  ],
                }));
                setDialog(null);
              }}
            >
              <label>
                视角名称
                <UiInput
                  required
                  maxLength={50}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <UiButton className="primary" type="submit">保存书签</UiButton>
            </form>
          ) : (
            <>
              {business.data.bookmarks.length === 0 && (
                <p className="empty-state">尚未保存视角</p>
              )}
              {business.data.bookmarks.map((b) => (
                <div className="bookmark-row" key={b.id}>
                  <UiButton
                    onClick={() => {
                      map?.restoreView?.(b.view);
                      setDialog(null);
                    }}
                  >
                    {b.name}
                  </UiButton>
                  <UiButton
                    onClick={() => {
                      if (
                        business.data.stations.some(
                          (s) => s.bookmarkId === b.id,
                        ) ||
                        business.data.plans.some((p) =>
                          p.points.some((n) => n.bookmarkId === b.id),
                        )
                      ) {
                        setError("该视角已被站点或方案引用，不能删除");
                        return;
                      }
                      business.update((old) => ({
                        ...old,
                        bookmarks: old.bookmarks.filter((x) => x.id !== b.id),
                      }));
                    }}
                  >
                    删除
                  </UiButton>
                </div>
              ))}
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
export function EnvironmentOverlay({ value }: { value: Environment }) {
  if (value === "none") return null;
  return (
    <div
      className={`environment-overlay ${value}`}
      aria-label={`${value === "rain" ? "雨景" : value === "snow" ? "雪景" : "雾景"}模拟`}
    >
      <div className="particles" />
      <span>
        视觉模拟 · {value === "rain" ? "雨" : value === "snow" ? "雪" : "雾"}
      </span>
    </div>
  );
}
