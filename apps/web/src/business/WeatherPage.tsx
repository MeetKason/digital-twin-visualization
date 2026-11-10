import { UiButton, UiCard } from "../ui/controls";
import { Alert, Menu, Table, Tag, type TableColumnsType } from "antd";
import { useEffect, useState } from "react";
import { deriveMockWeatherWarning, type DataFrame, type MockWeatherTopic } from "@dtv/contracts";
import type { MapFacade, LayerRuntime } from "@dtv/sdk";
import { beijingTime } from "../time";
import { api } from "../api";
import type { Business } from "./useBusiness";
const topics = ["暴雨洪涝", "强对流", "低温雨雪冰冻", "山洪地质灾害"];
const topicKeys: MockWeatherTopic[] = ["rainstorm", "convection", "cold-snow", "flash-flood"];
export function WeatherPage({
  business,
  map,
  runtime,
  sceneId,
  time,
}: {
  business: Business;
  map: MapFacade | null;
  runtime: LayerRuntime | null;
  sceneId: string;
  time: string;
}) {
  const [topic, setTopic] = useState(0),
    [frame, setFrame] = useState<DataFrame | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    // 专题只读取当前场景和时次；请求取消可防止切换页面后旧结果覆盖新状态。
    const ctrl = new AbortController();
    setFrame(null);
    setError("");
    // 无可用时次时展示缺数状态，避免发出空时次请求。
    if (!time) {
      setLoading(false);
      return () => ctrl.abort();
    }
    setLoading(true);
    void api
      .data(
        topic === 2 ? "temperature" : "rainfall",
        sceneId,
        time,
        ctrl.signal,
      )
      .then((next) => { if (!ctrl.signal.aborted) setFrame(next); })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [topic, sceneId, time]);
  useEffect(() => {
    if (!runtime) return;
    void runtime.toggle(topic === 2 ? "temperature" : "rainfall", true);
    return () => {
      void runtime.toggle(topic === 2 ? "temperature" : "rainfall", false);
    };
  }, [runtime, topic]);
  // 将观测按站点编码关联，再由共享 Mock 规则生成带来源标签的提示。
  const rows = business.data.stations.map((s) => ({
    station: s,
    observation: frame?.observations.find((o) => o.stationId === s.id),
    warning: deriveMockWeatherWarning(topicKeys[topic], frame?.observations.find((o) => o.stationId === s.id), s.elevationM),
  }));
  const warnedRows = rows.filter((row) => row.warning);
  const warningLevel = warnedRows.some((row) => row.warning?.level === "红色 Mock")
    ? "红色 Mock"
    : warnedRows.some((row) => row.warning?.level === "橙色 Mock")
      ? "橙色 Mock"
      : warnedRows.length ? "黄色 Mock" : "无 Mock 提示";
  const values = rows
    .map((r) =>
      topic === 2
        ? r.observation?.elements.temperatureC
        : r.observation?.elements.rainfallMm,
    )
    .filter((v): v is number => v !== null && v !== undefined);
  const statistic = values.length
    ? (topic === 2 ? Math.min(...values) : Math.max(...values)).toFixed(1)
    : "—";
  const tableColumns: TableColumnsType<(typeof rows)[number]> = [
    {
      title: "站点名称",
      key: "station",
      width: 180,
      render: (_, row) => (
        <UiButton variant="link" className="station-name-link" onClick={() => map?.flyTo(row.station.lon, row.station.lat, 9000)}>
          {row.station.name}
        </UiButton>
      ),
    },
    { title: "站点类型", dataIndex: ["station", "type"], key: "type", width: 150 },
    {
      title: "气象要素",
      key: "element",
      width: 120,
      render: () => (topic === 2 ? "气温" : "小时降水"),
    },
    {
      title: "当前值",
      key: "value",
      width: 120,
      align: "right",
      render: (_, row) => (
        <>
          {(topic === 2
            ? row.observation?.elements.temperatureC
            : row.observation?.elements.rainfallMm) ?? "—"}{" "}
          {topic === 2 ? "°C" : "mm"}
        </>
      ),
    },
    {
      title: "预警类型",
      key: "warning",
      width: 280,
      render: (_, row) => row.warning ? (
        <span className="weather-warning-cell">
          <Tag color={row.warning.level.startsWith("红") ? "red" : row.warning.level.startsWith("橙") ? "orange" : "gold"}>{row.warning.level}</Tag>
          <span>{row.warning.type} {row.warning.value.toFixed(1)} {row.warning.unit}</span>
        </span>
      ) : <Tag>{row.observation ? "无 Mock 提示" : "暂无观测"}</Tag>,
    },
    {
      title: "有效时次",
      key: "observedAt",
      width: 200,
      render: (_, row) => beijingTime(row.observation?.observedAt),
    },
  ];
  return (
    <div className="weather-page">
      <UiCard className="topic-catalog panel" bordered styles={{ body: { padding: 0 } }}>
        <div className="panel-heading">
          <strong>气象专题</strong>
        </div>
        <div className="panel-body">
          <p className="muted">选择专题 · 示例数据</p>
          <Menu
            className="weather-topic-menu"
            aria-label="气象专题选择"
            selectedKeys={[String(topic)]}
            onClick={({ key }) => setTopic(Number(key))}
            items={topics.map((label, index) => ({
              key: String(index), label: `${String(index + 1).padStart(2, "0")}  ${label}`,
            }))}
          />
          <p className="data-disclaimer">
            仅按页面展示的 Mock 阈值生成站点级提示，不生成正式风险范围或业务预警结论。
          </p>
        </div>
      </UiCard>
      <div className="topic-map-heading panel">
        {topics[topic]} · 重点站点 · {beijingTime(time)} UTC+8{" "}
        <span className="tag">Mock</span>
      </div>
      <UiCard className="topic-metrics panel" bordered styles={{ body: { padding: 0 } }}>
        <div className="panel-heading">
          <strong>专题指标</strong>
        </div>
        <div className="panel-body">
          {[
            [
              topic === 2 ? "最低温度" : "最大小时降水",
              `${statistic} ${topic === 2 ? "°C" : "mm"}`,
            ],
            ["关注站点", `${rows.filter((r) => r.observation).length} 个`],
            ["模拟影响站点", `${warnedRows.length} 个`],
            ["模拟提示等级", warningLevel],
          ].map(([name, value]) => (
            <div className="metric-block" key={name}>
              <span>{name}</span>
              <strong>{value}</strong>
            </div>
          ))}

        </div>
      </UiCard>
      <section className="topic-table panel">
        <div className="panel-heading">
          <strong>重点站点与预警列表</strong>
          <span>Mock 阈值结果 · 非正式预警</span>
        </div>
        {error && <Alert className="weather-data-alert" type="warning" showIcon message={`专题观测读取失败：${error}`} />}
        <Table
          className="weather-table"
          loading={loading}
          tableLayout="fixed"
          locale={{ emptyText: time ? "当前场景暂无站点" : "暂无可用时次" }}
          size="small"
          rowKey={(row) => row.station.id}
          dataSource={time ? rows : []}
          columns={tableColumns}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true, size: "small" }}
          scroll={{ x: 1050, y: "calc(clamp(240px, 34vh, 340px) - 130px)" }}
        />
      </section>
    </div>
  );
}
