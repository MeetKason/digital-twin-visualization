import { TenantAuthorization } from "./TenantAuthorization";
import { PluginManagement } from "./PluginPanels";
import type { ProductModule } from "@dtv/contracts";
import type { MapFacade } from "@dtv/sdk";
import type { useExtensions } from "../useExtensions";
import { ScenarioManager } from "./ScenarioManager";
import { sessionFetch } from "../sessionRequest";
import { readFile } from "./files";
import { UiButton } from "../ui/controls";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  ConfigProvider,
  Menu,
  Modal,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import type { Business } from "./useBusiness";
import { download } from "./useBusiness";
import { IngestionPanel } from "./IngestionPanel";
import { AuditLogPage } from "./AuditLogPage";
import { PublicationPage } from "./PublicationPage";
const AccountManagement = lazy(() =>
  import("./AccountManagement").then((module) => ({
    default: module.AccountManagement,
  })),
);
const sections = [
  "用户管理",
  "部署服务配置",
  "场景包管理",
  "租户产品授权",
  "插件管理",
  "账号开通/管理",
  "用户与权限",
  "发布管理",
  "操作审计",
  "站点数据",
];
export function SettingsPage({
  business,
  modules,
  extension,
  onDataChanged,
  onSceneApplied,
}: {
  business: Business;
  modules: ProductModule[];
  extension: ReturnType<typeof useExtensions>;
  onDataChanged: () => void;
  onSceneApplied: () => Promise<void>;
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
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          borderRadius: 4,
          fontFamily: '"PingFang SC", "Microsoft YaHei", Arial, sans-serif',
        },
      }}
    >
      <section className="business-page settings-page">
        <aside className="panel">
          <div className="panel-heading">
            <strong>管理目录</strong>
          </div>
          <div className="panel-body">
            <Menu
              className="settings-menu"
              mode="inline"
              selectedKeys={[section]}
              items={sections.map((s) => ({ key: s, label: s }))}
              onClick={({ key }) => setSection(key)}
            />
          </div>
        </aside>
        <section className="panel">
          <div className="panel-heading">
            <strong>{section}</strong>
            <span>
              {accountSection
                ? "真实登录账号与权限"
                : section === "场景包管理"
                  ? "草稿、发布与生效配置"
                  : section === "租户产品授权"
                    ? "许可证、套餐与授权范围"
                    : section === "插件管理"
                      ? "签名沙箱与扩展注册"
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
            {section === "租户产品授权" ? (
              <TenantAuthorization onApplied={onSceneApplied} />
            ) : section === "插件管理" ? (
              <PluginManagement extension={extension} />
            ) : section === "场景包管理" ? (
              <ScenarioManager
                sceneId={business.sceneId}
                onApplied={onSceneApplied}
                businessSaving={business.status.startsWith("正在保存")}
              />
            ) : accountSection ? (
              <Suspense fallback={<p className="muted">正在加载账号管理…</p>}>
                <AccountManagement />
              </Suspense>
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
                <Button
                  onClick={() =>
                    download(
                      "地图配置.json",
                      JSON.stringify(config, null, 2),
                      "application/json",
                    )
                  }
                >
                  导出当前配置
                </Button>
              </>
            ) : (
              <>
                {modules.includes("ingestion") ? (
                  <IngestionPanel
                    sceneId={business.sceneId}
                    onDataChanged={onDataChanged}
                  />
                ) : (
                  <Alert type="info" message="当前套餐未授权采集管理模块" />
                )}
                <p>
                  站点 {business.data.stations.length} 个 · 方案{" "}
                  {business.data.plans.length} 个 · 视角{" "}
                  {business.data.bookmarks.length} 个
                </p>
                <Button
                  onClick={() =>
                    download(
                      "本地演示资料.json",
                      JSON.stringify(business.data, null, 2),
                      "application/json",
                    )
                  }
                >
                  导出本地演示资料
                </Button>
                <p className="muted">
                  文件仅包含业务元数据，不包含服务器或旧浏览器中的模型和附件二进制；完整备份使用服务器成套备份脚本。
                </p>
              </>
            )}
            {error && <Alert type="error" showIcon message={error} />}
          </div>
        </section>
      </section>
    </ConfigProvider>
  );
}

export function DevicePage({ sceneId, map, onMap, business }: { sceneId: string; map: MapFacade | null; onMap: () => void; business: Business }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState("");
  const demoVideo = business.data.assets.find((asset) => asset.kind === "video");
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  const openVideo = async () => {
    if (!demoVideo) return;
    try {
      const blob = await readFile(sceneId, demoVideo.blobId);
      setVideoUrl(URL.createObjectURL(blob));
      setVideoError("");
    } catch (error) { setVideoError((error as Error).message); }
  };
  const [health, setHealth] = useState<{
      status: string;
      mode: string;
      version: string;
    } | null>(null),
    [devices, setDevices] = useState<
      {
        id: string;
        name: string;
        type: string;
        status: "online" | "warning" | "offline";
        temperatureC: number;
        batteryPercent: number;
        signalDbm: number;
        lastSeenAt: string;
        source: "mock";
        protocol: string;
        location: { lon: number; lat: number };
        alert: string | null;
      }[]
    >([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [healthResponse, devicesResponse] = await Promise.all([
        sessionFetch("/api/health"),
        sessionFetch(`/api/scenes/${encodeURIComponent(sceneId)}/devices`),
      ]);
      if (!healthResponse.ok || !devicesResponse.ok)
        throw new Error("设备模拟数据不可用");
      const [nextHealth, nextDevices] = await Promise.all([
        healthResponse.json(),
        devicesResponse.json(),
      ]);
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
  const warning = devices.filter(
    (device) => device.status === "warning",
  ).length;
  const offline = devices.filter(
    (device) => device.status === "offline",
  ).length;
  const statusLabel = {
    online: "在线（Mock）",
    warning: "告警（Mock）",
    offline: "离线（Mock）",
  };
  const columns: TableColumnsType<(typeof devices)[number]> = [
    {
      title: "设备",
      key: "name",
      width: 210,
      render: (_, device) => (
        <div className="device-name-cell">
          <strong>{device.name}</strong>
          <small>{device.id}</small>
        </div>
      ),
    },
    { title: "类型", dataIndex: "type", width: 150 },
    {
      title: "状态",
      key: "status",
      width: 150,
      render: (_, device) => (
        <Tag
          color={
            device.status === "online"
              ? "green"
              : device.status === "warning"
                ? "orange"
                : "default"
          }
        >
          {statusLabel[device.status]}
        </Tag>
      ),
    },
    {
      title: "温度",
      key: "temperature",
      width: 100,
      align: "right",
      render: (_, device) => `${device.temperatureC.toFixed(1)} °C`,
    },
    {
      title: "电池",
      key: "battery",
      width: 90,
      align: "right",
      render: (_, device) => `${device.batteryPercent}%`,
    },
    {
      title: "信号",
      key: "signal",
      width: 110,
      align: "right",
      render: (_, device) => `${device.signalDbm} dBm`,
    },
    {
      title: "最近心跳",
      key: "lastSeen",
      width: 200,
      render: (_, device) =>
        new Date(device.lastSeenAt).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        }),
    },
    { title: "数据源", dataIndex: "protocol", width: 160 },
    {
      title: "地图联动",
      key: "map",
      width: 145,
      render: (_, device) => (
        <Button onClick={() => {
          map?.showDeviceAlert?.({ name: device.name, ...device.location, alert: device.alert });
          map?.flyTo(device.location.lon, device.location.lat, 6000);
          onMap();
        }}>定位设备</Button>
      ),
    },
  ];
  return (
    <section className="business-page device-page panel">
      <div className="panel-heading">
        <strong>设备监控</strong>
        <UiButton className="mini" onClick={() => void refresh()}>
          刷新状态
        </UiButton>
      </div>
      <div className="panel-body">
        <h2>设备监控 · Mock 演示</h2>
        <p className="data-disclaimer">
          以下设备、心跳和遥测均为确定性模拟数据，仅用于页面与告警交互验收，不代表真实设备接入状态；视频流和真实协议尚未接入。
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="ingestion-metrics">
          <span>设备总数 {devices.length}</span>
          <span>在线 {online}</span>
          <span>异常 {warning}</span>
          <span>离线 {offline}</span>
        </div>
        {devices.filter((device) => device.alert).map((device) => (
          <Alert key={device.id} type="warning" showIcon message={`${device.name} · ${device.alert}`} action={<><Button size="small" disabled={!demoVideo} onClick={() => void openVideo()}>查看演示视频</Button><Button size="small" onClick={() => {
            map?.showDeviceAlert?.({ name: device.name, ...device.location, alert: device.alert });
            map?.flyTo(device.location.lon, device.location.lat, 6000);
            onMap();
          }}>地图定位</Button></>} />
        ))}
        {videoError && <Alert type="error" showIcon message={videoError} />}
        <Modal open={!!videoUrl} title="Mock 告警关联视频 · 演示资料" footer={null} onCancel={() => setVideoUrl(null)} destroyOnHidden>
          {videoUrl && <video controls autoPlay src={videoUrl} style={{ width: "100%" }} />}
        </Modal>
        <Table
          aria-label="Mock 设备遥测清单"
          className="device-table"
          size="small"
          rowKey="id"
          tableLayout="fixed"
          dataSource={devices}
          columns={columns}
          pagination={{
            pageSize: 10,
            hideOnSinglePage: true,
            showSizeChanger: false,
          }}
          scroll={{ x: 1150 }}
        />
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
