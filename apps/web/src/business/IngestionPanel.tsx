import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import type {
  DataFrame,
  IngestionHealth,
  IngestionJob,
  IngestionStatus,
} from "@dtv/contracts";
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
const sourceName = (source: "mock" | "tianqing" | "other" | undefined) =>
  source === "tianqing" ? "天擎" : source === "other" ? "其他" : "Mock";
const labels = {
  queued: "等待执行",
  running: "正在采集",
  retrying: "等待重试",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
interface IngestionProductOption {
  id: string;
  label: string;
  available: boolean;
  dependencies: string[];
}
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
    [health, setHealth] = useState<IngestionHealth | null>(null),
    [products, setProducts] = useState<IngestionProductOption[]>([]),
    [productId, setProductId] = useState("surface-hourly"),
    [role, setRole] = useState<SessionUser["role"] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [start, setStart] = useState(() => localHour(Date.now() - hour)),
    [end, setEnd] = useState(() => localHour(Date.now())),
    [frame, setFrame] = useState<DataFrame | null>(null);
  const version = useRef(""),
    alive = useRef(true);
  const base = `/api/scenes/${encodeURIComponent(sceneId)}/ingestion`;
  const scopedBase = `${base}?productId=${encodeURIComponent(productId)}`;
  const scopedHealth = `${base}/health?productId=${encodeURIComponent(productId)}`;
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let pendingStatus = false;
    // 定时刷新任务和进度，清理时取消未完成请求并停止定时器。
    const refreshStatus = async () => {
      if (pendingStatus) return;
      pendingStatus = true;
      try {
        const next = await json<IngestionStatus>(scopedBase, controller.signal);
        if (!controller.signal.aborted) {
          setStatus(next);
          const stamp = `${productId}:${next.mode}:${next.watermark}:${next.lastSuccessAt}`;
          if (version.current && version.current !== stamp) onDataChanged();
          version.current = stamp;
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        pendingStatus = false;
      }
    };
    const refreshHealth = async () => {
      try {
        const next = await json<IngestionHealth>(
          scopedHealth,
          controller.signal,
        );
        if (!controller.signal.aborted) setHealth(next);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    };
    void authApi
      .session()
      .then((s) => {
        if (alive.current) setRole(s.user?.role ?? null);
      })
      .catch(() => {});
    void json<IngestionProductOption[]>(base + "/products", controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setProducts(items);
      })
      .catch(() => {});
    void refreshStatus();
    void refreshHealth();
    const timer = setInterval(() => void refreshStatus(), 1500);
    const healthTimer = setInterval(() => void refreshHealth(), 15000);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
      clearInterval(healthTimer);
    };
  }, [base, scopedBase, scopedHealth, productId, onDataChanged]);
  /** 执行采集面板的统一写请求，随后刷新服务端任务状态。 */
  async function action(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const payload =
        body && typeof body === "object"
          ? { ...(body as Record<string, unknown>), productId }
          : body;
      await json(base + path, undefined, method, payload);
      onDataChanged();
      if (!alive.current) return;
      const [next, nextHealth] = await Promise.all([
        json<IngestionStatus>(scopedBase),
        json<IngestionHealth>(scopedHealth),
      ]);
      if (!alive.current) return;
      setStatus(next);
      setHealth(nextHealth);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const writable = role === "admin" || role === "editor";
  const jobColumns: TableColumnsType<IngestionJob> = [
    {
      title: "时次区间（北京时间）",
      key: "range",
      width: 230,
      render: (_value, job) => (
        <>
          {display(job.startTime)}
          <br />
          {display(job.endTime)}
          <small>
            {sourceName(job.source)} ·{" "}
            {job.kind === "scheduled" ? "定时" : "手动"}
          </small>
        </>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (value: IngestionJob["status"]) => {
        const color =
          value === "succeeded"
            ? "green"
            : value === "failed"
              ? "red"
              : value === "running"
                ? "blue"
                : value === "retrying"
                  ? "orange"
                  : undefined;
        return <Tag color={color}>{labels[value]}</Tag>;
      },
    },
    {
      title: "进度",
      key: "progress",
      width: 120,
      render: (_value, job) => (
        <>
          {job.completedHours}/{job.totalHours} 小时
          <br />
          {job.rowCount} 条
        </>
      ),
    },
    {
      title: "本小时尝试",
      dataIndex: "attempts",
      key: "attempts",
      width: 110,
      render: (value: number) => `${value}/3`,
    },
    {
      title: "错误",
      dataIndex: "error",
      key: "error",
      width: 220,
      render: (value: string | null) => value ?? "—",
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value, job) => (
        <Space wrap size={[4, 6]}>
          {job.status === "failed" && (
            <Button
              size="small"
              disabled={busy || !writable}
              onClick={() => void action(`/jobs/${job.id}/retry`, "POST")}
            >
              重试任务
            </Button>
          )}
          {!(["succeeded", "cancelled"] as string[]).includes(job.status) && (
            <Button
              size="small"
              danger
              disabled={busy || !writable}
              onClick={() => void action(`/jobs/${job.id}/cancel`, "POST")}
            >
              取消任务
            </Button>
          )}
        </Space>
      ),
    },
  ];
  const observationColumns: TableColumnsType<
    DataFrame["observations"][number]
  > = [
    { title: "站号", dataIndex: "stationId", key: "stationId", width: 160 },
    {
      title: "气温 °C",
      key: "temperatureC",
      render: (_value, row) => row.elements.temperatureC ?? "—",
    },
    {
      title: "小时降水 mm",
      key: "rainfallMm",
      render: (_value, row) => row.elements.rainfallMm ?? "—",
    },
    {
      title: "风速 m/s",
      key: "windSpeedMs",
      render: (_value, row) => row.elements.windSpeedMs ?? "—",
    },
  ];
  return (
    <section className="ingestion-panel" aria-label="采集与补数管理">
      <h3>采集与补数</h3>
      <label className="ingestion-product-control">
        采集产品
        <Select
          value={productId}
          disabled={busy}
          onChange={setProductId}
          options={products.map((product) => ({
            value: product.id,
            label: `${product.label}${product.available ? "" : "（未接入）"}`,
            disabled: !product.available,
          }))}
        />
      </label>
      {products.find((product) => product.id === productId)?.available ===
        false && (
        <Alert
          type="warning"
          showIcon
          message="该产品尚无可用连接器，不能创建采集任务或启用计划。"
        />
      )}
      <p className="data-disclaimer">
        当前源：{sourceName(status?.source)}。
        {status?.source === "tianqing"
          ? "请求由服务端按地区配置签名，不会向浏览器暴露账号或口令。"
          : "使用本地模拟观测，不用于业务研判。"}
        任务会真实保存、执行和入库；每个任务最多168小时，失败按5秒、10秒退避重试，连续3次失败后可人工重试。
      </p>
      {health && (
        <section className="ingestion-health" aria-label="采集健康告警">
          <div className="ingestion-metrics">
            <span>待执行 {health.metrics.pendingJobs}</span>
            <span>失败 {health.metrics.failedJobs}</span>
            <span>缺测时次 {health.metrics.missingHours}</span>
            <span>累计观测行 {health.metrics.totalRows}</span>
          </div>
          {health.alerts.length ? (
            <ul className="ingestion-alerts">
              {health.alerts.map((alert) => (
                <li key={alert.code} data-severity={alert.severity}>
                  <strong>
                    {alert.severity === "critical" ? "告警" : "提醒"}
                  </strong>
                  {alert.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">当前任务范围内未发现缺测或积压告警。</p>
          )}
          {!!health.missingTimes.length && (
            <p className="muted">
              缺测时次（最多显示 168 个）：{" "}
              {health.missingTimes.map((time) => display(time)).join("、")}
            </p>
          )}
          <small>
            状态检查 {display(health.checkedAt)} · 来源{" "}
            {sourceName(health.source)}
          </small>
        </section>
      )}
      <dl>
        <dt>数据模式</dt>
        <dd>
          {status?.mode === "ingested"
            ? `入库观测（${sourceName(status.source)}）`
            : "固定演示数据"}
        </dd>
        <dt>最近成功入库时次</dt>
        <dd>{display(status?.watermark ?? null)}</dd>
        <dt>最近成功时间</dt>
        <dd>{display(status?.lastSuccessAt ?? null)}</dd>
      </dl>
      <div className="ingestion-setting-row">
        <Switch
          aria-label="使用入库观测"
          disabled={busy || role !== "admin" || !status}
          checked={status?.mode === "ingested"}
          onChange={(checked) =>
            void action("/config", "PUT", {
              mode: checked ? "ingested" : "demo",
            })
          }
        />
        使用入库观测
      </div>
      <div className="ingestion-setting-row">
        <Switch
          aria-label="启用每小时定时采集"
          disabled={
            busy ||
            role !== "admin" ||
            !status ||
            products.find((product) => product.id === productId)?.available ===
              false
          }
          checked={status?.schedule.enabled ?? false}
          onChange={(checked) =>
            void action("/config", "PUT", { enabled: checked })
          }
        />
        启用每小时定时采集（{sourceName(status?.source)}）
      </div>
      <p className="muted">
        仅管理员能切换模式与定时计划。入库模式无资料时显示缺数；定时计划停机后最多自动追补最近24小时，更早时次请手动补数。自动计划领取后创建的任务需单独取消，关闭计划不会取消已有任务。
      </p>
      <Button
        type="primary"
        disabled={busy || !writable || !status}
        onClick={() => {
          const time = new Date(
            Math.floor(Date.now() / hour) * hour,
          ).toISOString();
          void action("/jobs", "POST", {
            source: status?.source ?? "mock",
            productId,
            startTime: time,
            endTime: time,
          });
        }}
      >
        采集最新时次
      </Button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action("/jobs", "POST", {
            source: status?.source ?? "mock",
            productId,
            startTime: start + ":00+08:00",
            endTime: end + ":00+08:00",
          });
        }}
      >
        <div className="form-grid">
          <label>
            补数开始（北京时间）
            <Input
              required
              type="datetime-local"
              step="3600"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            补数结束（北京时间）
            <Input
              required
              type="datetime-local"
              step="3600"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <Button
          type="primary"
          htmlType="submit"
          disabled={busy || !writable || !status}
        >
          提交补数任务
        </Button>
      </form>
      {error && (
        <Alert
          type="error"
          showIcon
          message={`${error}；状态可能未刷新，稍后重新进入此栏目可重试。`}
        />
      )}
      {!status ? (
        <p>正在读取采集队列…</p>
      ) : (
        <>
          <Table<IngestionJob>
            className="ingestion-table"
            rowKey="id"
            columns={jobColumns}
            dataSource={status.jobs}
            loading={busy}
            scroll={{ x: 920 }}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            locale={{ emptyText: "暂无采集任务" }}
          />
          <Button
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
          </Button>
          {frame && (
            <div aria-label="入库数据预览">
              <p>
                {sourceName(frame.source)} · {display(frame.observedAt)} ·{" "}
                {frame.observations.length} 条（
                {frame.storage === "ingested" ? "入库观测" : "固定演示"}）
              </p>
              <Table<DataFrame["observations"][number]>
                className="ingestion-preview-table"
                size="small"
                rowKey="stationId"
                columns={observationColumns}
                dataSource={frame.observations}
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
