import { useEffect, useRef, useState } from "react";
import type { CruiseController, CruiseProgress, MapFacade } from "@dtv/sdk";
import { movePoint, validatePlan, type CruisePoint } from "@dtv/contracts";
import type { Business } from "./useBusiness";
import { Modal } from "./Modal";
import { ModelManager } from "./ModelManager";
import { readFile } from "./files";
export function CruisePanel({
  business,
  map,
}: {
  business: Business;
  map: MapFacade | null;
}) {
  const { data, update } = business;
  const [selected, setSelected] = useState(data.plans[0]?.id ?? ""),
    [pointId, setPointId] = useState(""),
    [picker, setPicker] = useState(false),
    [models, setModels] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<CruiseProgress | null>(null);
  const controller = useRef<CruiseController | null>(null),
    cancelPick = useRef<(() => void) | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  function cancelSelection() {
    cancelPick.current?.();
    cancelPick.current = null;
    setPicker(false);
  }
  useEffect(() => {
    cancelSelection();
  }, [selected]);
  const plan = data.plans.find((p) => p.id === selected),
    point = plan?.points.find((p) => p.id === pointId) ?? plan?.points[0];
  useEffect(() => map?.showCruisePath?.(plan?.points ?? []), [map, plan]);
  const running = progress?.state === "playing" || progress?.state === "paused";
  useEffect(
    () => () => {
      controller.current?.stop();
      cancelPick.current?.();
    },
    [],
  );
  useEffect(() => {
    if (!map?.placeModel || !plan) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    for (const point of plan.points) {
      const asset = data.assets.find((a) => a.id === point.modelId);
      if (
        !asset ||
        data.stations.some(
          (s) =>
            s.modelId === asset.id &&
            s.lon === point.lon &&
            s.lat === point.lat,
        )
      )
        continue;
      void readFile(asset.blobId)
        .then((blob) => {
          if (disposed) return;
          const url = URL.createObjectURL(blob);
          const remove = map.placeModel?.(
            url,
            point.lon,
            point.lat,
            point.height,
            asset.scale ?? 1,
            asset.heading ?? 0,
          );
          cleanups.push(() => {
            remove?.();
            URL.revokeObjectURL(url);
          });
        })
        .catch((e) => setError(e.message));
    }
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [map, plan, data.assets, data.stations]);
  function edit(
    change: (old: NonNullable<typeof plan>) => NonNullable<typeof plan>,
  ) {
    if (!plan || running) return;
    update((old) => ({
      ...old,
      plans: old.plans.map((p) =>
        p.id === plan.id ? { ...change(p), saved: false } : p,
      ),
    }));
  }
  function add(
    name: string,
    lon: number,
    lat: number,
    height: number,
    modelId?: string,
    bookmarkId?: string,
  ) {
    const p: CruisePoint = {
      id: crypto.randomUUID(),
      name,
      lon,
      lat,
      height,
      duration: 10,
      transition: 2,
      direction: 1,
      loops: 1,
      radius: 5000,
      pitch: -45,
      modelId,
      bookmarkId,
      angle: 360,
      flightHeight: 3000,
      curve: "smooth",
    };
    edit((old) => ({ ...old, points: [...old.points, p] }));
    setPointId(p.id);
    setPicker(false);
  }
  function start() {
    try {
      if (!plan?.saved) throw new Error("请先保存方案再开始漫游");
      validatePlan(plan);
      if (!map?.startCruise) throw new Error("地图尚未就绪");
      controller.current = map.startCruise(
        plan.points.map((p) => ({
          ...p,
          view: data.bookmarks.find((b) => b.id === p.bookmarkId)?.view,
        })),
        setProgress,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <section className="cruise-library panel">
        <div className="panel-heading">
          <strong>漫游方案</strong>
          <span>{data.plans.length} 个</span>
        </div>
        <div className="panel-body">
          <button
            className="primary wide"
            onClick={() => {
              cancelSelection();
              controller.current?.stop();
              const id = crypto.randomUUID();
              update((old) => ({
                ...old,
                plans: [
                  ...old.plans,
                  { id, name: "新建漫游方案", points: [], saved: false },
                ],
              }));
              setSelected(id);
              setProgress(null);
            }}
          >
            新建方案
          </button>
          {data.plans.map((p) => (
            <button
              key={p.id}
              className={`catalog-card ${p.id === selected ? "active" : ""}`}
              onClick={() => {
                cancelSelection();
                controller.current?.stop();
                setSelected(p.id);
                setPointId("");
                setProgress(null);
              }}
            >
              <strong>{p.name}</strong>
              <small>
                {p.points.length} 个节点 · {p.saved ? "已保存" : "编辑中"}
              </small>
            </button>
          ))}
          <p className="data-disclaimer">
            本地演示方案，按地区保存。拖拽地图会停止正在运行的相机巡航。
          </p>
        </div>
      </section>
      <section className="cruise-editor panel">
        <div className="panel-heading">
          <strong>漫游方案</strong>
          <span>
            {running
              ? progress?.state === "paused"
                ? "已暂停"
                : "漫游中"
              : plan?.saved
                ? "已保存"
                : "编辑中"}
          </span>
        </div>
        <div className="panel-body">
          <h3>历史书签</h3>
          <div className="bookmark-chips">
            {data.bookmarks.map((b) => (
              <button key={b.id} onClick={() => map?.restoreView?.(b.view)}>
                {b.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const view = map?.captureView?.();
              if (view)
                update((old) => ({
                  ...old,
                  bookmarks: [
                    ...old.bookmarks,
                    {
                      id: crypto.randomUUID(),
                      name: `漫游镜头 ${old.bookmarks.length + 1}`,
                      view,
                    },
                  ],
                }));
            }}
          >
            保存当前视角
          </button>
          <h3>模型库</h3>
          <button onClick={() => setModels(true)}>管理/上传模型</button>
          <p className="muted">
            {data.assets.filter((a) => a.kind === "model").length} 个已登记
          </p>
          {plan ? (
            <>
              <h3>方案设置</h3>
              <fieldset disabled={running}>
                <label>
                  漫游方案名称
                  <input
                    maxLength={80}
                    value={plan.name}
                    onChange={(e) =>
                      edit((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <h3>点位序列</h3>
                {plan.points.map((p, i) => (
                  <div
                    key={p.id}
                    className={`cruise-point ${point?.id === p.id ? "active" : ""}`}
                  >
                    <button
                      onClick={() => {
                        setPointId(p.id);
                        map?.flyTo(p.lon, p.lat, 10000);
                      }}
                    >
                      {String(i + 1).padStart(2, "0")} {p.name}
                    </button>
                    <button
                      aria-label={`上移节点${i + 1}`}
                      disabled={i === 0}
                      onClick={() =>
                        edit((old) => ({
                          ...old,
                          points: movePoint(old.points, i, i - 1),
                        }))
                      }
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`下移节点${i + 1}`}
                      disabled={i === plan.points.length - 1}
                      onClick={() =>
                        edit((old) => ({
                          ...old,
                          points: movePoint(old.points, i, i + 1),
                        }))
                      }
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`删除节点${i + 1}`}
                      onClick={() =>
                        edit((old) => ({
                          ...old,
                          points: old.points.filter((x) => x.id !== p.id),
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="tool-grid">
                  <button
                    onClick={() => {
                      cancelPick.current?.();
                      setError("请在地图单击选择巡航点");
                      cancelPick.current =
                        map?.pickCoordinate?.((lon, lat, height) => {
                          if (selectedRef.current !== plan.id) return;
                          add(
                            `地图点 ${plan.points.length + 1}`,
                            lon,
                            lat,
                            height,
                          );
                          setError("");
                        }) ?? null;
                    }}
                  >
                    地图选点
                  </button>
                  <button onClick={() => setPicker(true)}>从站点添加</button>
                </div>
                {point && (
                  <>
                    <h3>当前点位环绕参数 · {point.name}</h3>
                    <div className="form-grid">
                      {(
                        [
                          ["radius", "环绕半径(m)"],
                          ["height", "镜头目标高程(m)"],
                          ["pitch", "俯仰角(°)"],
                          ["duration", "单点环绕时长(秒)"],
                          ["loops", "循环次数"],
                          ["transition", "转场时长(秒)"],
                          ["angle", "环绕角度(°)"],
                          ["flightHeight", "转场飞行高度(m)"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            step={key === "transition" ? ".1" : "1"}
                            value={point[key] ?? (key === "angle" ? 360 : 3000)}
                            onChange={(e) =>
                              edit((old) => ({
                                ...old,
                                points: old.points.map((p) =>
                                  p.id === point.id
                                    ? { ...p, [key]: Number(e.target.value) }
                                    : p,
                                ),
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      飞行曲线
                      <select
                        value={point.curve ?? "smooth"}
                        onChange={(e) =>
                          edit((old) => ({
                            ...old,
                            points: old.points.map((p) =>
                              p.id === point.id
                                ? {
                                    ...p,
                                    curve: e.target.value as
                                      | "smooth"
                                      | "linear",
                                  }
                                : p,
                            ),
                          }))
                        }
                      >
                        <option value="smooth">平滑曲线(缓入缓出)</option>
                        <option value="linear">线性转场</option>
                      </select>
                    </label>
                    <label>
                      旋转方向
                      <select
                        value={point.direction}
                        onChange={(e) =>
                          edit((old) => ({
                            ...old,
                            points: old.points.map((p) =>
                              p.id === point.id
                                ? {
                                    ...p,
                                    direction: Number(e.target.value) as 1 | -1,
                                  }
                                : p,
                            ),
                          }))
                        }
                      >
                        <option value={1}>顺时针</option>
                        <option value={-1}>逆时针</option>
                      </select>
                    </label>
                    <label>
                      关联三维模型
                      <select
                        value={point.modelId ?? ""}
                        onChange={(e) =>
                          edit((old) => ({
                            ...old,
                            points: old.points.map((p) =>
                              p.id === point.id
                                ? { ...p, modelId: e.target.value || undefined }
                                : p,
                            ),
                          }))
                        }
                      >
                        <option value="">不绑定模型</option>
                        {data.assets
                          .filter((a) => a.kind === "model")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      关联保存视角
                      <select
                        value={point.bookmarkId ?? ""}
                        onChange={(e) =>
                          edit((old) => ({
                            ...old,
                            points: old.points.map((p) =>
                              p.id === point.id
                                ? {
                                    ...p,
                                    bookmarkId: e.target.value || undefined,
                                  }
                                : p,
                            ),
                          }))
                        }
                      >
                        <option value="">使用当前点参数</option>
                        {data.bookmarks.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </fieldset>
              <div className="tool-grid">
                <button
                  className="primary"
                  disabled={running}
                  onClick={() => {
                    try {
                      validatePlan(plan);
                      update((old) => ({
                        ...old,
                        plans: old.plans.map((p) =>
                          p.id === plan.id ? { ...p, saved: true } : p,
                        ),
                      }));
                      setError("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  保存方案
                </button>
                <button disabled={running} onClick={start}>
                  开始漫游
                </button>
              </div>
              <button
                disabled={running}
                onClick={() => {
                  update((old) => ({
                    ...old,
                    plans: old.plans.filter((p) => p.id !== plan.id),
                  }));
                  cancelSelection();
                  setSelected("");
                }}
              >
                删除方案
              </button>
            </>
          ) : (
            <p className="empty-state">选择或新建漫游方案</p>
          )}
          {error && (
            <p role="status" className="error-text">
              {error}
            </p>
          )}
        </div>
      </section>
      <section className="cruise-playback panel">
        <strong>{plan?.name ?? "路径漫游"}</strong>
        <span>
          {progress
            ? `${progress.state === "playing" ? "自动漫游进行中" : progress.state === "paused" ? "已暂停" : progress.state === "complete" ? "漫游完成" : "已停止"} · 节点 ${progress.index + 1}/${plan?.points.length ?? 0} · ${progress.phase === "transition" ? "转场" : "环绕"}`
            : "保存方案后开始漫游"}
        </span>
        {running && (
          <>
            <button
              className="primary"
              onClick={() =>
                progress?.state === "paused"
                  ? controller.current?.resume()
                  : controller.current?.pause()
              }
            >
              {progress?.state === "paused" ? "继续漫游" : "暂停漫游"}
            </button>
            <button onClick={() => controller.current?.stop()}>停止漫游</button>
          </>
        )}
        <progress value={progress?.fraction ?? 0} max={1} />
      </section>
      {picker && (
        <Modal title="从站点添加" onClose={() => setPicker(false)}>
          {data.stations.map((s) => (
            <button
              className="search-result"
              key={s.id}
              onClick={() =>
                add(s.name, s.lon, s.lat, s.elevationM, s.modelId, s.bookmarkId)
              }
            >
              添加 {s.name}
            </button>
          ))}
        </Modal>
      )}
      {models && (
        <ModelManager
          business={business}
          map={map}
          lon={point?.lon ?? data.stations[0]?.lon ?? 0}
          lat={point?.lat ?? data.stations[0]?.lat ?? 0}
          height={point?.height}
          onClose={() => setModels(false)}
          onChoose={(id) => {
            if (point)
              edit((old) => ({
                ...old,
                points: old.points.map((p) =>
                  p.id === point.id ? { ...p, modelId: id } : p,
                ),
              }));
          }}
        />
      )}
    </>
  );
}
