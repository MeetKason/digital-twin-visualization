import { useEffect, useRef, useState } from "react";
import type { DataFrame, IngestionStatus } from "@dtv/contracts";
import { authApi, type SessionUser } from "../api";
const hour = 3600000;
const localHour = (time: number) =>
  new Date(Math.floor(time / hour) * hour + 8 * hour)
    .toISOString()
    .slice(0, 16);
const display = (time: string | null) =>
  time
    ? new Date(time).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
const labels = {
  queued: "等待执行",
  running: "正在采集",
  retrying: "等待重试",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
async function json<T>(
  url: string,
  signal?: AbortSignal,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    signal,
    method,
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-DTV-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json();
  if (!res.ok) throw new Error(value.message ?? "采集请求失败");
  return value;
}
export function IngestionPanel({
  sceneId,
  onDataChanged,
}: {
  sceneId: string;
  onDataChanged: () => void;
}) {
  const [status, setStatus] = useState<IngestionStatus | null>(null),
    [role, setRole] = useState<SessionUser["role"] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [start, setStart] = useState(() => localHour(Date.now() - hour)),
    [end, setEnd] = useState(() => localHour(Date.now())),
    [frame, setFrame] = useState<DataFrame | null>(null);
  const version = useRef(""),
    alive = useRef(true);
  const base = `/api/scenes/${encodeURIComponent(sceneId)}/ingestion`;
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await json<IngestionStatus>(base, controller.signal);
        if (!controller.signal.aborted) {
          setStatus(next);
          const stamp = `${next.mode}:${next.watermark}:${next.lastSuccessAt}`;
          if (version.current && version.current !== stamp) onDataChanged();
          version.current = stamp;
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void authApi
      .session()
      .then((s) => {
        if (alive.current) setRole(s.user?.role ?? null);
      })
      .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [base, onDataChanged]);
  async function action(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await json(base + path, undefined, method, body);
      onDataChanged();
      if (!alive.current) return;
      const next = await json<IngestionStatus>(base);
      if (!alive.current) return;
      setStatus(next);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const writable = role === "admin" || role === "editor";
  return (
    <section className="ingestion-panel" aria-label="采集与补数管理">
      <h3>采集与补数</h3>
      <p className="data-disclaimer">
        当前源：Mock
        模拟观测。任务会真实保存、执行和入库；尚未连接天擎，不用于业务研判。每个任务最多168小时，失败按5秒、10秒退避重试，连续3次失败后可人工重试。
      </p>
      <dl>
        <dt>数据模式</dt>
        <dd>
          {status?.mode === "ingested" ? "入库观测（Mock）" : "固定演示数据"}
        </dd>
        <dt>最近成功入库时次</dt>
        <dd>{display(status?.watermark ?? null)}</dd>
        <dt>最近成功时间</dt>
        <dd>{display(status?.lastSuccessAt ?? null)}</dd>
      </dl>
      <label>
        <input
          type="checkbox"
          disabled={busy || role !== "admin" || !status}
          checked={status?.mode === "ingested"}
          onChange={(e) =>
            void action("/config", "PUT", {
              mode: e.target.checked ? "ingested" : "demo",
            })
          }
        />
        使用入库观测
      </label>
      <label>
        <input
          type="checkbox"
          disabled={busy || role !== "admin" || !status}
          checked={status?.schedule.enabled ?? false}
          onChange={(e) =>
            void action("/config", "PUT", { enabled: e.target.checked })
          }
        />
        启用每小时 Mock 定时采集
      </label>
      <p className="muted">
        仅管理员能切换模式与定时计划。入库模式无资料时显示缺数；定时计划停机后最多自动追补最近24小时，更早时次请手动补数。自动计划领取后创建的任务需单独取消，关闭计划不会取消已有任务。
      </p>
      <button
        disabled={busy || !writable || !status}
        onClick={() => {
          const time = new Date(
            Math.floor(Date.now() / hour) * hour,
          ).toISOString();
          void action("/jobs", "POST", {
            source: "mock",
            startTime: time,
            endTime: time,
          });
        }}
      >
        采集最新时次
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action("/jobs", "POST", {
            source: "mock",
            startTime: start + ":00+08:00",
            endTime: end + ":00+08:00",
          });
        }}
      >
        <div className="form-grid">
          <label>
            补数开始（北京时间）
            <input
              required
              type="datetime-local"
              step="3600"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            补数结束（北京时间）
            <input
              required
              type="datetime-local"
              step="3600"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <button className="primary" disabled={busy || !writable || !status}>
          提交补数任务
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}；状态可能未刷新，稍后重新进入此栏目可重试。
        </p>
      )}
      {!status ? (
        <p>正在读取采集队列…</p>
      ) : (
        <>
          {!status.jobs.length && <p>暂无采集任务</p>}
          <div className="ingestion-jobs">
            <table>
              <thead>
                <tr>
                  <th>时次区间（北京时间）</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>本小时尝试</th>
                  <th>错误</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {status.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      {display(job.startTime)}
                      <br />
                      {display(job.endTime)}
                      <small>
                        Mock · {job.kind === "scheduled" ? "定时" : "手动"}
                      </small>
                    </td>
                    <td>{labels[job.status]}</td>
                    <td>
                      {job.completedHours}/{job.totalHours} 小时
                      <br />
                      {job.rowCount} 条
                    </td>
                    <td>{job.attempts}/3</td>
                    <td>{job.error ?? "—"}</td>
                    <td>
                      {job.status === "failed" && (
                        <button
                          disabled={busy || !writable}
                          onClick={() =>
                            void action(`/jobs/${job.id}/retry`, "POST")
                          }
                        >
                          重试任务
                        </button>
                      )}
                      {!["succeeded", "cancelled"].includes(job.status) && (
                        <button
                          disabled={busy || !writable}
                          onClick={() =>
                            void action(`/jobs/${job.id}/cancel`, "POST")
                          }
                        >
                          取消任务
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={!status.watermark || busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void json<DataFrame>(
                base +
                  "/observations?time=" +
                  encodeURIComponent(status.watermark!),
              )
                .then((next) => {
                  if (alive.current) setFrame(next);
                })
                .catch((e) => {
                  if (alive.current) {
                    setFrame(null);
                    setError(e.message);
                  }
                })
                .finally(() => {
                  if (alive.current) setBusy(false);
                });
            }}
          >
            预览最近入库时次
          </button>
          {frame && (
            <div aria-label="入库数据预览">
              <p>
                Mock · {display(frame.observedAt)} · {frame.observations.length}{" "}
                条（{frame.storage === "ingested" ? "入库观测" : "固定演示"}）
              </p>
              <table>
                <thead>
                  <tr>
                    <th>站号</th>
                    <th>气温 °C</th>
                    <th>小时降水 mm</th>
                    <th>风速 m/s</th>
                  </tr>
                </thead>
                <tbody>
                  {frame.observations.map((row) => (
                    <tr key={row.stationId}>
                      <td>{row.stationId}</td>
                      <td>{row.elements.temperatureC ?? "—"}</td>
                      <td>{row.elements.rainfallMm ?? "—"}</td>
                      <td>{row.elements.windSpeedMs ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
