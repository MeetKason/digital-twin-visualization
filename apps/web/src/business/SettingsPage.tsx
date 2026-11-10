import { useCallback, useEffect, useState } from "react";
import type { Business } from "./useBusiness";
import { download } from "./useBusiness";
import { IngestionPanel } from "./IngestionPanel";
import { AccountManagement } from "./AccountManagement";
import { AuditLogPage } from "./AuditLogPage";
import { PublicationPage } from "./PublicationPage";
const sections = [
  "用户管理",
  "部署服务配置",
  "账号开通/管理",
  "用户与权限",
  "发布管理",
  "操作审计",
  "站点数据",
];
export function SettingsPage({
  business,
  onDataChanged,
}: {
  business: Business;
  onDataChanged: () => void;
}) {
  const [section, setSection] = useState(sections[0]),
    [config, setConfig] = useState<unknown>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const ctrl = new AbortController();
    void fetch("/config.json", { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setConfig)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
    return () => ctrl.abort();
  }, []);
  const accountSection = ["用户管理", "账号开通/管理", "用户与权限"].includes(
    section,
  );
  const auditSection = section === "操作审计";
  const publicationSection = section === "发布管理";
  return (
    <section className="business-page settings-page">
      <aside className="panel">
        <div className="panel-heading">
          <strong>管理目录</strong>
        </div>
        <div className="panel-body">
          {sections.map((s) => (
            <button
              className={`catalog-card ${s === section ? "active" : ""}`}
              key={s}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </aside>
      <section className="panel">
        <div className="panel-heading">
          <strong>{section}</strong>
          <span>
            {accountSection
              ? "真实登录账号与权限"
              : auditSection
                ? "租户范围内的服务端操作记录"
                : publicationSection
                  ? "修订快照与发布历史"
                : section === "站点数据"
                  ? "服务端资料与采集"
                  : "演示配置"}
          </span>
        </div>
        <div className="panel-body">
          {accountSection ? (
            <AccountManagement />
          ) : auditSection ? (
            <AuditLogPage />
          ) : publicationSection ? (
            <PublicationPage business={business} />
          ) : section === "部署服务配置" ? (
            <>
              <h3>当前地图服务配置</h3>
              <pre className="config-view">
                {JSON.stringify(config, null, 2)}
              </pre>
              <p className="muted">
                部署配置由项目 config.json
                管理；浏览器不保存天擎凭据。修改地址前需要现场服务资料。
              </p>
              <button
                onClick={() =>
                  download(
                    "地图配置.json",
                    JSON.stringify(config, null, 2),
                    "application/json",
                  )
                }
              >
                导出当前配置
              </button>
            </>
          ) : (
            <>
              <IngestionPanel
                sceneId={business.sceneId}
                onDataChanged={onDataChanged}
              />
              <p>
                站点 {business.data.stations.length} 个 · 方案{" "}
                {business.data.plans.length} 个 · 视角{" "}
                {business.data.bookmarks.length} 个
              </p>
              <button
                onClick={() =>
                  download(
                    "本地演示资料.json",
                    JSON.stringify(business.data, null, 2),
                    "application/json",
                  )
                }
              >
                导出本地演示资料
              </button>
              <p className="muted">
                文件仅包含业务元数据，不包含服务器或旧浏览器中的模型和附件二进制；完整备份使用服务器成套备份脚本。
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      </section>
    </section>
  );
}

export function DevicePage({ sceneId }: { sceneId: string }) {
  const [health, setHealth] = useState<{
      status: string;
      mode: string;
      version: string;
    } | null>(null),
    [devices, setDevices] = useState<{
      id: string; name: string; type: string; status: "online" | "warning" | "offline";
      temperatureC: number; batteryPercent: number; signalDbm: number;
      lastSeenAt: string; source: "mock"; protocol: string;
    }[]>([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [healthResponse, devicesResponse] = await Promise.all([
        fetch("/api/health"),
        fetch(`/api/scenes/${encodeURIComponent(sceneId)}/devices`),
      ]);
      if (!healthResponse.ok || !devicesResponse.ok) throw new Error("设备模拟数据不可用");
      const [nextHealth, nextDevices] = await Promise.all([healthResponse.json(), devicesResponse.json()]);
      setHealth(nextHealth);
      setDevices(nextDevices);
      setError("");
    } catch (e) {
      setHealth(null);
      setError((e as Error).message);
    }
  }, [sceneId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  const online = devices.filter((device) => device.status === "online").length;
  const warning = devices.filter((device) => device.status === "warning").length;
  const offline = devices.filter((device) => device.status === "offline").length;
  const statusLabel = { online: "在线（Mock）", warning: "告警（Mock）", offline: "离线（Mock）" };
  return (
    <section className="business-page device-page panel">
      <div className="panel-heading">
        <strong>设备监控</strong>
        <button className="mini" onClick={() => void refresh()}>
          刷新状态
        </button>
      </div>
      <div className="panel-body">
        <h2>设备监控 · Mock 演示</h2>
        <p className="data-disclaimer">以下设备、心跳和遥测均为确定性模拟数据，仅用于页面与告警交互验收，不代表真实设备接入状态；视频流和真实协议尚未接入。</p>
        {error && <p role="alert" className="error-text">{error}</p>}
        <div className="ingestion-metrics">
          <span>设备总数 {devices.length}</span>
          <span>在线 {online}</span>
          <span>异常 {warning}</span>
          <span>离线 {offline}</span>
        </div>
        <div className="table-scroll">
          <table aria-label="Mock 设备遥测清单">
            <thead><tr><th>设备</th><th>类型</th><th>状态</th><th>温度</th><th>电池</th><th>信号</th><th>最近心跳</th><th>数据源</th></tr></thead>
            <tbody>{devices.map((device) => <tr key={device.id} data-status={device.status}>
              <td>{device.name}<small>{device.id}</small></td><td>{device.type}</td><td>{statusLabel[device.status]}</td>
              <td>{device.temperatureC.toFixed(1)} °C</td><td>{device.batteryPercent}%</td><td>{device.signalDbm} dBm</td>
              <td>{new Date(device.lastSeenAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</td><td>{device.protocol}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <h3>本机 API 健康</h3>
        <dl>
          <dt>API 状态</dt>
          <dd>{health?.status ?? error ?? "检查中"}</dd>
          <dt>运行模式</dt>
          <dd>{health?.mode ?? "—"}</dd>
          <dt>核心版本</dt>
          <dd>{health?.version ?? "—"}</dd>
          <dt>设备协议</dt>
          <dd>未接入</dd>
        </dl>
      </div>
    </section>
  );
}
