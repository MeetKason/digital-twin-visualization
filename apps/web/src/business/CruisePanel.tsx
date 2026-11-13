import { UiButton, UiInput, UiSelect } from "../ui/controls";
import { InputNumber, message, Popconfirm, Slider } from "antd";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import type { CruiseController, CruiseProgress, MapFacade } from "@dtv/sdk";
import { movePoint, validatePlan, type CruisePoint } from "@dtv/contracts";
import type { Business } from "./useBusiness";
import { Modal } from "./Modal";
import { readFile } from "./files";
import { createId } from "../id";
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
    [mapPicking, setMapPicking] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<CruiseProgress | null>(null);
  const controller = useRef<CruiseController | null>(null),
    cancelPick = useRef<(() => void) | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  function cancelSelection() {
    // 结束地图拾取并清理回调，避免面板关闭后残留一次性地图事件。
    cancelPick.current?.();
    cancelPick.current = null;
    setMapPicking(false);
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
      void readFile(business.sceneId, asset.blobId)
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
  }, [map, plan, data.assets, data.stations, business.sceneId]);
  function edit(
    change: (old: NonNullable<typeof plan>) => NonNullable<typeof plan>,
  ) {
    // 漫游运行期间冻结方案修改；任何编辑均标记为未发布保存状态。
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
      id: createId(),
      name,
      lon,
      lat,
      height,
      duration: 10,
      transition: 2,
      direction: 1,
      loops: 1,
      radius: 2000,
      pitch: -20,
      modelId,
      bookmarkId,
      angle: 0,
      flightHeight: 3000,
      curve: "smooth",
    };
    edit((old) => ({ ...old, points: [...old.points, p] }));
    setPointId(p.id);
    setPicker(false);
  }
  function start() {
    // 启动前由共享契约校验路径，进度控制器负责播放、暂停和停止生命周期。
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
        plan.speedMps ?? 130,
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
          <UiButton
            className="primary wide"
            disabled={!business.canWrite}
            onClick={async () => {
              if (!business.canWrite) {
                setError(business.error || "服务端资料仍在加载，请稍后再新建方案");
                return;
              }
              cancelSelection();
              controller.current?.stop();
              const id = createId();
              const saved = await update((old) => ({
                ...old,
                plans: [
                  ...old.plans,
                  { id, name: "新建漫游方案", points: [], saved: false, speedMps: 130 },
                ],
              }));
              if (!saved) {
                setError(business.error || "新建方案未保存，请检查服务端资料状态后重试");
                return;
              }
              setSelected(id);
              setProgress(null);
              setError("");
            }}
          >
            新建方案
          </UiButton>
          {!business.canWrite && (
            <p role="status" className="muted">
              {business.error || business.status}
            </p>
          )}
          {data.plans.map((p) => (
            <UiButton
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
            </UiButton>
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
              <UiButton key={b.id} onClick={() => map?.restoreView?.(b.view)}>
                {b.name}
              </UiButton>
            ))}
          </div>
          <UiButton
            onClick={() => {
              const view = map?.captureView?.();
              if (view)
                update((old) => ({
                  ...old,
                  bookmarks: [
                    ...old.bookmarks,
                    {
                      id: createId(),
                      name: `漫游镜头 ${old.bookmarks.length + 1}`,
                      view,
                    },
                  ],
                }));
            }}
          >
            保存当前视角
          </UiButton>
          {plan ? (
            <>
              <h3>方案设置</h3>
              <fieldset disabled={running}>
                <label>
                  漫游方案名称
                  <UiInput
                    maxLength={80}
                    value={plan.name}
                    onChange={(e) =>
                      edit((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <label className="cruise-speed-control">
                  默认速度 (m/s)
                  <InputNumber
                    aria-label="默认漫游速度（米/秒）"
                    min={10}
                    max={1000}
                    step={10}
                    value={plan.speedMps ?? 130}
                    onChange={(value) => {
                      if (value !== null)
                        edit((old) => ({ ...old, speedMps: value }));
                    }}
                  />
                </label>
                <h3>点位序列</h3>
                {plan.points.map((p, i) => (
                  <div
                    key={p.id}
                    className={`cruise-point ${point?.id === p.id ? "active" : ""}`}
                  >
                    <UiButton
                      onClick={() => {
                        setPointId(p.id);
                        map?.flyTo(p.lon, p.lat, 10000);
                      }}
                    >
                      {String(i + 1).padStart(2, "0")} {p.name}
                    </UiButton>
                    <UiButton
                      aria-label={`上移节点${i + 1}`}
                      disabled={i === 0}
                      onClick={() =>
                        edit((old) => ({
                          ...old,
                          points: movePoint(old.points, i, i - 1),
                        }))
                      }
                    >
                      <Icon name="up" size={16} />
                    </UiButton>
                    <UiButton
                      aria-label={`下移节点${i + 1}`}
                      disabled={i === plan.points.length - 1}
                      onClick={() =>
                        edit((old) => ({
                          ...old,
                          points: movePoint(old.points, i, i + 1),
                        }))
                      }
                    >
                      <Icon name="down" size={16} />
                    </UiButton>
                    <Popconfirm
                      title={`确认删除点位“${p.name}”吗？`}
                      description="删除后需要重新添加才能恢复。"
                      okText="确认删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      placement="topRight"
                      onConfirm={() =>
                        edit((old) => ({
                          ...old,
                          points: old.points.filter((x) => x.id !== p.id),
                        }))
                      }
                    >
                      <UiButton aria-label={`删除节点${i + 1}`}>
                        <Icon name="close" size={16} />
                      </UiButton>
                    </Popconfirm>
                  </div>
                ))}
                <div className="tool-grid">
                  <UiButton
                    className={mapPicking ? "primary" : ""}
                    onClick={() => {
                      if (mapPicking) {
                        cancelSelection();
                        setError("已取消地图选点");
                        return;
                      }
                      cancelPick.current?.();
                      if (!map?.pickCoordinate) {
                        setError("地图尚未就绪，暂时无法选点");
                        return;
                      }
                      setError("请在地图单击选择巡航点");
                      cancelPick.current =
                        map.pickCoordinate((lon, lat, height) => {
                          cancelPick.current = null;
                          setMapPicking(false);
                          if (selectedRef.current !== plan.id) return;
                          add(
                            `地图点 ${plan.points.length + 1}`,
                            lon,
                            lat,
                            height,
                          );
                          setError("");
                        });
                      setMapPicking(true);
                    }}
                  >
                    {mapPicking ? "取消选点" : "地图选点"}
                  </UiButton>
                  <UiButton onClick={() => setPicker(true)}>从站点添加</UiButton>
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
                          <UiInput
                            type="number"
                            step={key === "transition" ? ".1" : "1"}
                            value={point[key] ?? (key === "angle" ? 0 : 3000)}
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
                      <UiSelect
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
                      </UiSelect>
                    </label>
                    <label>
                      旋转方向
                      <UiSelect
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
                      </UiSelect>
                    </label>
                    <label>
                      关联三维模型
                      <UiSelect
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
                      </UiSelect>
                    </label>
                    <label>
                      关联保存视角
                      <UiSelect
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
                      </UiSelect>
                    </label>
                  </>
                )}
              </fieldset>
              <div className="tool-grid">
                <UiButton
                  className="primary"
                  disabled={running}
                  onClick={async () => {
                    try {
                      validatePlan(plan);
                      const saved = await update((old) => ({
                        ...old,
                        plans: old.plans.map((p) =>
                          p.id === plan.id ? { ...p, saved: true } : p,
                        ),
                      }));
                      if (!saved) {
                        const reason = business.error || "漫游方案保存失败，请检查网络后重试";
                        setError(reason);
                        message.error(reason);
                        return;
                      }
                      setError("");
                      message.success("漫游方案保存成功");
                    } catch (e) {
                      const reason = (e as Error).message;
                      setError(reason);
                      message.error(reason);
                    }
                  }}
                >
                  保存方案
                </UiButton>
                <UiButton disabled={running} onClick={start}>
                  开始漫游
                </UiButton>
              </div>
              <Popconfirm
                title={`确认删除方案“${plan.name}”吗？`}
                description={`该方案的 ${plan.points.length} 个点位也会一并删除。`}
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                placement="topRight"
                onConfirm={() => {
                  update((old) => ({
                    ...old,
                    plans: old.plans.filter((p) => p.id !== plan.id),
                  }));
                  cancelSelection();
                  setSelected("");
                }}
              >
                <UiButton disabled={running}>删除方案</UiButton>
              </Popconfirm>
            </>
          ) : (
            <p className="empty-state">选择或新建漫游方案</p>
          )}
          {(error || business.error) && (
            <p role="status" className="error-text">
              {error || business.error}
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
        <UiButton
          aria-label="上一巡航点"
          disabled={!running || !progress || progress.index <= 0}
          onClick={() => controller.current?.seek((progress?.index ?? 0) - 1)}
        >
          <Icon name="previous" size={18} />
        </UiButton>
        {running && (
          <>
            <UiButton
              className="primary"
              onClick={() =>
                progress?.state === "paused"
                  ? controller.current?.resume()
                  : controller.current?.pause()
              }
            >
              {progress?.state === "paused" ? "继续漫游" : "暂停漫游"}
            </UiButton>
            <UiButton onClick={() => controller.current?.stop()}>停止漫游</UiButton>
          </>
        )}
        <UiButton
          aria-label="下一巡航点"
          disabled={!running || !progress || !plan || progress.index >= plan.points.length - 1}
          onClick={() => controller.current?.seek((progress?.index ?? 0) + 1)}
        >
          <Icon name="next" size={18} />
        </UiButton>
        <Slider
          className="cruise-progress-slider"
          aria-label="巡航节点进度"
          min={0}
          max={Math.max(0, (plan?.points.length ?? 1) - 1)}
          step={0.01}
          disabled={!running || !progress || (plan?.points.length ?? 0) < 2}
          value={progress ? progress.index + progress.fraction : 0}
          marks={Object.fromEntries((plan?.points ?? []).map((point, index) => [index, `节点${index + 1}`]))}
          onChange={(value) => controller.current?.seek(Number(value))}
        />
      </section>
      {picker && (
        <Modal title="从站点添加" onClose={() => setPicker(false)}>
          {data.stations.map((s) => (
            <UiButton
              className="search-result"
              key={s.id}
              onClick={() =>
                add(s.name, s.lon, s.lat, s.elevationM, s.modelId, s.bookmarkId)
              }
            >
              添加 {s.name}
            </UiButton>
          ))}
        </Modal>
      )}
    </>
  );
}
