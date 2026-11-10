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
    [error, setError] = useState("");
  useEffect(() => {
    // 专题只读取当前场景和时次；请求取消可防止切换页面后旧结果覆盖新状态。
    const ctrl = new AbortController();
    setFrame(null);
    setError("");
    void api
      .data(
        topic === 2 ? "temperature" : "rainfall",
        sceneId,
        time,
        ctrl.signal,
      )
      .then(setFrame)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
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
  return (
    <div className="weather-page">
      <aside className="topic-catalog panel">
        <div className="panel-heading">
          <strong>气象专题</strong>
        </div>
        <div className="panel-body">
          <p className="muted">选择专题 · 示例数据</p>
          {topics.map((t, i) => (
            <button
              key={t}
              aria-label={t}
              className={`catalog-card ${topic === i ? "active" : ""}`}
              onClick={() => setTopic(i)}
            >
              {String(i + 1).padStart(2, "0")} {t}
            </button>
          ))}
          <p className="data-disclaimer">
            仅按页面展示的 Mock 阈值生成站点级提示，不生成正式风险范围或业务预警结论。
          </p>
        </div>
      </aside>
      <div className="topic-map-heading panel">
        {topics[topic]} · 重点站点 · {beijingTime(time)} UTC+8{" "}
        <span className="tag">Mock</span>
      </div>
      <aside className="topic-metrics panel">
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
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      </aside>
      <section className="topic-table panel">
        <div className="panel-heading">
          <strong>重点站点与预警列表</strong>
          <span>Mock 阈值结果 · 非正式预警</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "站点名称",
                  "站点类型",
                  "气象要素",
                  "当前值",
                  "预警类型",
                  "有效时次",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ station: s, observation: o, warning }) => (
                <tr key={s.id}>
                  <td>
                    <button onClick={() => map?.flyTo(s.lon, s.lat, 9000)}>
                      {s.name}
                    </button>
                  </td>
                  <td>{s.type}</td>
                  <td>{topic === 2 ? "气温" : "小时降水"}</td>
                  <td>
                    {(topic === 2
                      ? o?.elements.temperatureC
                      : o?.elements.rainfallMm) ?? "—"}{" "}
                    {topic === 2 ? "°C" : "mm"}
                  </td>
                  <td>{warning ? `${warning.level} · ${warning.type} ${warning.value.toFixed(1)} ${warning.unit}` : "无 Mock 提示"}</td>
                  <td>{beijingTime(o?.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
