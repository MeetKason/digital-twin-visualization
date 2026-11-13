import { useEffect, useState } from "react";
import { Button, Card, Tag } from "antd";
import type { DataFrame } from "@dtv/contracts";
import type { LayerRuntime } from "@dtv/sdk";
import { beijingProductTime, beijingTime } from "./time";
import { windSpeedStops } from "./weatherRendering";

const products = [
  ["temperature", "气温", "°C", "低 → 高"],
  ["rainfall", "1小时降水", "mm", "0 · 10 · 25 · 50 · 100"],
  ["radar", "雷达回波", "dBZ", "5 · 10 · 20 · 30 · 40 · 50 · 60 · 70"],
  ["satellite", "卫星云图", "%", "0 · 云量 · 100"],
  ["wind", "风场", "m/s", "箭头指向去向"],
  ["forecast", "逐小时预报", "°C", "低 → 高"],
] as const;

/** 图例只展示已加载且与时间轴一致的数据；加载期间不沿用旧帧标记。 */
export function WeatherLegend({ runtime, frames, time, hidden, sceneName, onLocate }: {
  runtime: LayerRuntime | null; frames: Record<string, DataFrame>; time: string; hidden: boolean; sceneName: string; onLocate: () => void;
}) {
  const [, render] = useState(0);
  useEffect(() => runtime?.subscribe(() => render((value) => value + 1)), [runtime]);
  const active = products.filter(([id]) => runtime?.snapshot(id).status === "on" && frames[id] && Date.parse(frames[id].observedAt) === Date.parse(time));
  if (hidden || !active.length) return null;
  const windOn = active.some(([id]) => id === "wind");
  const temperatureOn = active.some(([id]) => id === "temperature");
  const productTime = beijingProductTime(time);
  const windTicks = windSpeedStops.map(([stop], index) => index === windSpeedStops.length - 1 ? `${stop}+` : String(stop));
  return <>
  {windOn && productTime && <div className="wind-field-title" role="status">
    {temperatureOn && <div>{sceneName}{productTime}平均气温图</div>}
    <div>{temperatureOn ? "" : sceneName}{productTime}风场图</div>
  </div>}
  <Card className={`map-legend product-legend${windOn ? " has-wind" : ""}`} size="small" aria-label="气象产品图例" styles={{ body: { padding: 10 } }}>
    <Button size="small" onClick={onLocate}>定位产品范围</Button>
    {active.map(([id, name, unit, scale]) => <div className="product-legend-item" key={id}>
      <strong>{name} {unit} <Tag>{frames[id].source === "mock" ? "Mock 示例" : "入库资料"}</Tag></strong>
      <div className={`legend-gradient ${id}`} />
      {id === "wind" ? <div className="legend-ticks">{windTicks.map((tick) => <span key={tick}>{tick}</span>)}</div> : null}
      <small>{scale}</small>
      {frames[id].forecast && <p className="forecast-validity">
        起报 {beijingTime(frames[id].forecast.referenceTime)}<br />
        有效 {beijingTime(frames[id].forecast.validTime)} · +{frames[id].forecast.leadHours}小时
      </p>}
    </div>)}
  </Card>
  </>;
}
