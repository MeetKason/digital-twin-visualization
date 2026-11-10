import { UiButton, UiInput, UiSlider } from "./ui/controls";
import { Switch } from "antd";
import { UiList } from "./ui/controls";
import { useEffect, useState } from "react";
import type {
  LayerDescriptor,
  LayerCategory,
  SearchResult,
  Station,
} from "@dtv/contracts";
import type { LayerRuntime, MapFacade } from "@dtv/sdk";
import { api } from "./api";
import { Icon } from "./Icon";
export function LayerPanel({
  layers,
  runtime,
  sceneId,
  map,
  onClose,
  onStation,
  stations,
}: {
  layers: LayerDescriptor[];
  stations: Station[];
  runtime: LayerRuntime | null;
  sceneId: string;
  map: MapFacade | null;
  onClose: () => void;
  onStation: (s: Station) => void;
}) {
  const [category, setCategory] = useState<LayerCategory>("weather"),
    [selected, setSelected] = useState("temperature"),
    [query, setQuery] = useState(""),
    [result, setResult] = useState<SearchResult | null>(null),
    [error, setError] = useState(""),
    [searching, setSearching] = useState(false);
  const [, render] = useState(0);
  useEffect(() => runtime?.subscribe(() => render((n) => n + 1)), [runtime]);
  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      setError("");
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void api
        .search(sceneId, query, ctrl.signal)
        .then((r) => {
          setResult(r);
          setError("");
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) {
            setError(e.message);
            setResult(null);
          }
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, sceneId]);
  const matchingStations = [
    ...new Map(
      [
        ...(result?.stations ?? []).filter(
          (s) => !stations.some((local) => local.id === s.id),
        ),
        ...stations.filter(
          (s) =>
            query.trim() &&
            (s.name.includes(query.trim()) || s.id.includes(query.trim())),
        ),
      ].map((s) => [s.id, s]),
    ).values(),
  ];
  const layer = layers.find((l) => l.id === selected);
  const state = runtime?.snapshot(selected);
  const rows = query.trim()
    ? (result?.layers ?? [])
    : layers.filter((l) => l.category === category);
  return (
    <section className="layer-panel panel">
      <div className="panel-heading">
        <strong>地图内容</strong>
        <UiButton className="mini" aria-label="收起图层面板" onClick={onClose}>
          收起 <Icon name="close" size={14} />
        </UiButton>
      </div>
      <div className="panel-body">
        <div className="category-tabs">
          {(
            [
              ["weather", "气象要素"],
              ["base", "基础图层"],
              ["station", "站点图层"],
            ] as const
          ).map(([id, name]) => (
            <UiButton
              key={id}
              className={category === id ? "active" : ""}
              onClick={() => setCategory(id)}
            >
              {name}
            </UiButton>
          ))}
        </div>
        <div className="search-field">
          <UiInput
            placeholder="搜索图层 / 站点 / 坐标"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Icon name="search" size={20} />
        </div>
        <div className="section-label">
          {query
            ? "搜索结果"
            : category === "weather"
              ? "气象要素"
              : category === "base"
                ? "基础地理"
                : "气象站点"}
          <span />
        </div>
        {searching && <p className="muted">正在搜索…</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {query && result?.coordinate && (
          <UiButton
            className="search-result"
            onClick={() => map?.flyTo(...result.coordinate!)}
          >
            定位到 {result.coordinate.join(", ")}
          </UiButton>
        )}
        {query &&
          matchingStations.map((s) => (
            <UiButton
              className="search-result"
              key={s.id}
              onClick={() => {
                map?.flyTo(s.lon, s.lat);
                onStation(s);
              }}
            >
              {s.name}
              <small>{s.id}</small>
            </UiButton>
          ))}
        <UiList
          className="layer-list"
          split={false}
          dataSource={rows}
          renderItem={(l) => {
            const s = runtime?.snapshot(l.id);
            return (
              <UiList.Item
                key={l.id}
                data-layer={l.id}
                data-status={s?.status ?? "off"}
                className={`layer-item ${selected === l.id ? "selected" : ""}`}
              >
                <div className="layer-row">
                  <UiButton
                    className="layer-name"
                    onClick={() => setSelected(l.id)}
                  >
                    {l.name}
                  </UiButton>
                  <span className={`tag ${l.tag === "预警" ? "orange" : ""}`}>
                    {l.tag}
                  </span>
                  <Switch
                    aria-label={l.name}
                    checked={s?.status === "on" || s?.status === "loading"}
                    loading={s?.status === "loading"}
                    disabled={!runtime}
                    onChange={(checked) => {
                      setSelected(l.id);
                      void runtime?.toggle(l.id, checked);
                    }}
                  />
                </div>
                {s?.status === "error" && (
                  <div className="layer-error">
                    {s.error}
                    <UiButton onClick={() => void runtime?.toggle(l.id, true)}>
                      重试
                    </UiButton>
                  </div>
                )}
              </UiList.Item>
            );
          }}
        />
        {query &&
          result &&
          !result.coordinate &&
          !result.layers.length &&
          !matchingStations.length && (
            <p className="empty-state">没有匹配的图层或站点</p>
          )}
        <div className="opacity-control">
          <div>
            <label htmlFor="opacity">图层透明度</label>
            <span>{Math.round((state?.opacity ?? 0.8) * 100)}%</span>
          </div>
          <UiSlider
            id="opacity"
            aria-label="选中图层透明度"

            min="0"
            max="100"
            value={Math.round((state?.opacity ?? 0.8) * 100)}
            disabled={!runtime || !layer?.opacitySupported}
            onChange={(e) =>
              runtime?.setOpacity(selected, Number(e.target.value) / 100)
            }
          />
          <small>
            {layer?.name}
            {!layer?.opacitySupported ? " · 暂不支持透明度" : ""}
          </small>
        </div>
        <div className="data-disclaimer">
          演示目录 · 气温与降水为示例色块
          <br />
          其他产品需现场接入授权数据
        </div>
      </div>
    </section>
  );
}
