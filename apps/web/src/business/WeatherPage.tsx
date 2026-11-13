import { UiButton, UiCard } from "../ui/controls";
import { Alert, Menu, Select, Table, Tag, type TableColumnsType } from "antd";
import { useEffect, useRef, useState } from "react";
import { deriveMockWeatherWarning, type DataFrame, type MockWeatherTopic } from "@dtv/contracts";
import type { MapFacade, LayerRuntime } from "@dtv/sdk";
import type { Station } from "@dtv/contracts";
import { beijingTime } from "../time";
import { api } from "../api";
import type { Business } from "./useBusiness";
const topics = ["暴雨洪涝", "强对流", "低温雨雪冰冻", "山洪地质灾害"];
const topicDescriptions = [
  "降水 / 水位 / 城区积水风险点",
  "雷达 / 闪电 / 短时强降水",
  "温度 / 道路结冰 / 低温提示",
  "雨量 / 监测站 / 地质风险区域",
];
const topicKeys: MockWeatherTopic[] = ["rainstorm", "convection", "cold-snow", "flash-flood"];
export function WeatherPage({
  business,
  map,
  runtime,
  sceneId,
  time,
  times,
  onStation,
}: {
  business: Business;
  map: MapFacade | null;
  runtime: LayerRuntime | null;
  sceneId: string;
  time: string;
  times: string[];
  onStation: (station: Station) => void;
}) {
  const [topic, setTopic] = useState(0),
    [frames, setFrames] = useState<DataFrame[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [scope, setScope] = useState<"city" | "focus">("city"),
    [windowSize, setWindowSize] = useState<1 | 3 | 6>(1);
  const frameCache = useRef(new Map<string, DataFrame>());
  useEffect(() => {
    // 专题只读取当前场景和时次；请求取消可防止切换页面后旧结果覆盖新状态。
    const ctrl = new AbortController();
    setFrames([]);
    setError("");
    // 无可用时次时展示缺数状态，避免发出空时次请求。
    if (!time) {
      setLoading(false);
      return () => ctrl.abort();
    }
    setLoading(true);
    const analysisTimes = times
      .filter((candidate) => Date.parse(candidate) <= Date.parse(time))
      .slice(-windowSize);
    if (!analysisTimes.includes(time)) analysisTimes.push(time);
    const product = topic === 2 ? "temperature" : "rainfall";
    // 相邻时次复用已读的确定性 Mock 帧；时间轴拖动时只请求新增时次。
    void Promise.allSettled(analysisTimes.map((candidate) => {
      const cacheKey = `${sceneId}:${product}:${candidate}`;
      const cached = frameCache.current.get(cacheKey);
      if (cached) return Promise.resolve(cached);
      return api.data(product, sceneId, candidate, ctrl.signal).then((next) => {
        frameCache.current.set(cacheKey, next);
        return next;
      });
    }))
      .then((results) => {
        if (ctrl.signal.aborted) return;
        const available = analysisTimes
          .map((candidate) => frameCache.current.get(`${sceneId}:${product}:${candidate}`))
          .filter((candidate): candidate is DataFrame => !!candidate);
        setFrames(available);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") setError((failed.reason as Error).message);
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [topic, sceneId, time, times, windowSize]);
  useEffect(() => {
    if (!runtime) return;
    void runtime.toggle(topic === 2 ? "temperature" : "rainfall", true);
    return () => {
      void runtime.toggle(topic === 2 ? "temperature" : "rainfall", false);
    };
  }, [runtime, topic]);
  // 将观测按站点编码关联，再由共享 Mock 规则生成带来源标签的提示。
  const latestFrame = frames.at(-1);
  const rows = business.data.stations.map((station) => {
    const observation = latestFrame?.observations.find((item) => item.stationId === station.id);
    const warnings = frames
      .map((frame) => deriveMockWeatherWarning(
        topicKeys[topic],
        frame.observations.find((item) => item.stationId === station.id),
        station.elevationM,
      ))
      .filter((warning): warning is NonNullable<typeof warning> => !!warning);
    const warning = warnings.sort((a, b) =>
      ({ "红色 Mock": 3, "橙色 Mock": 2, "黄色 Mock": 1 }[b.level] -
        { "红色 Mock": 3, "橙色 Mock": 2, "黄色 Mock": 1 }[a.level]),
    )[0];
    return { station, observation, warning };
  });
  const warnedRows = rows.filter((row) => row.warning);
  const visibleRows = scope === "focus" ? warnedRows : rows;
  const warningLevel = warnedRows.some((row) => row.warning?.level === "红色 Mock")
    ? "红色 Mock"
    : warnedRows.some((row) => row.warning?.level === "橙色 Mock")
      ? "橙色 Mock"
      : warnedRows.length ? "黄色 Mock" : "无 Mock 提示";
  const visibleStationIds = new Set(visibleRows.map((row) => row.station.id));
  const values = frames
    .flatMap((frame) => frame.observations
      .filter((observation) => visibleStationIds.has(observation.stationId))
      .map((observation) =>
        topic === 2 ? observation.elements.temperatureC : observation.elements.rainfallMm,
      ),
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
        <UiButton variant="link" className="station-name-link" onClick={() => {
          map?.flyTo(row.station.lon, row.station.lat, 9000);
          onStation(row.station);
        }}>
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
          <div className="weather-analysis-controls">
            <label>
              <span>分析范围</span>
              <Select
                aria-label="分析范围"
                value={scope}
                options={[
                  { value: "city", label: "西安市全域" },
                  { value: "focus", label: "重点站点" },
                ]}
                onChange={(value) => setScope(value)}
              />
            </label>
            <label>
              <span>分析时段</span>
              <Select
                aria-label="分析时段"
                value={windowSize}
                options={[
                  { value: 1, label: "当前时次" },
                  { value: 3, label: "近 3 个时次" },
                  { value: 6, label: "近 6 个时次" },
                ]}
                onChange={(value) => setWindowSize(value as 1 | 3 | 6)}
              />
            </label>
          </div>
          <Menu
            className="weather-topic-menu"
            aria-label="气象专题选择"
            selectedKeys={[String(topic)]}
            onClick={({ key }) => setTopic(Number(key))}
            items={topics.map((label, index) => ({
              key: String(index),
              label: (
                <span className="weather-topic-item">
                  <strong>{String(index + 1).padStart(2, "0")}　{label}</strong>
                  <small>{topicDescriptions[index]}</small>
                </span>
              ),
            }))}
          />
          <p className="data-disclaimer">
            仅按页面展示的 Mock 阈值生成站点级提示，不生成正式风险范围或业务预警结论。
          </p>
        </div>
      </UiCard>
      <div className="topic-map-heading panel">
        {topics[topic]} · {scope === "city" ? "西安市全域" : "重点站点"} · {windowSize === 1 ? "当前时次" : `近 ${windowSize} 个时次`} · {beijingTime(time)} UTC+8{" "}
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
            ["关注站点", `${visibleRows.filter((r) => r.observation).length} 个`],
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
          locale={{ emptyText: !time ? "暂无可用时次" : scope === "focus" ? "当前时段暂无重点预警站点" : "当前场景暂无站点" }}
          size="small"
          rowKey={(row) => row.station.id}
          dataSource={time ? visibleRows : []}
          columns={tableColumns}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true, size: "small" }}
          scroll={{ x: 1050, y: "calc(clamp(240px, 34vh, 340px) - 130px)" }}
        />
      </section>
    </div>
  );
}
