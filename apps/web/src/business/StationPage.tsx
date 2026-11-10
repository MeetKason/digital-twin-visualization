import { UiButton, UiInput, UiList, UiSelect, UiUpload } from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import {
  csvCell,
  parseStationCsv,
  parseCoordinate,
  saveStation,
  type ManagedStation,
  type Asset,
  type DataFrame,
} from "@dtv/contracts";
import type { MapFacade } from "@dtv/sdk";
import { beijingTime } from "../time";
import { api } from "../api";
import { Modal } from "./Modal";
import { FileMaintenance } from "./FileMaintenance";
import { ModelManager } from "./ModelManager";
import { download, type Business } from "./useBusiness";
import {
  readFile,
  storeFile,
  deleteFile,
  migrateFile,
  persistUploadedFile,
} from "./files";
const types = [
  "国家有人站",
  "国家无人站",
  "雷达站",
  "高空观测站",
  "土壤水分站",
  "人影高炮点",
  "人影火箭点",
  "灾害风险点",
  "视频点位",
  "收藏点位",
];
export function StationPage({
  business,
  map,
  sceneId,
  time,
  onMap,
}: {
  business: Business;
  map: MapFacade | null;
  sceneId: string;
  time: string;
  onMap: () => void;
}) {
  const { data, update } = business;
  const alive = useRef(true),
    viewRequest = useRef(0);
  useEffect(
    () => () => {
      alive.current = false;
      viewRequest.current++;
    },
    [],
  );
  const [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [dialog, setDialog] = useState<ManagedStation | null>(null),
    [isNew, setIsNew] = useState(false),
    [models, setModels] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<ReturnType<typeof parseStationCsv> | null>(
      null,
    ),
    [draft, setDraft] = useState<ManagedStation | null>(null),
    [viewing, setViewing] = useState<{ url: string; asset: Asset } | null>(
      null,
    );
  const station =
    data.stations.find((s) => s.id === selected) ?? data.stations[0];
  useEffect(() => {
    setDraft(station ? { ...station } : null);
  }, [station]);
  useEffect(
    () => () => {
      if (viewing) URL.revokeObjectURL(viewing.url);
    },
    [viewing],
  );
  function locate(s: ManagedStation) {
    map?.flyTo(s.lon, s.lat, 8000);
    onMap();
  }
  function save(item: ManagedStation, editing?: string) {
    // 业务校验在共享契约中完成，成功后通过服务端修订队列保存站点集合。
    try {
      const next = saveStation(data.stations, item, editing);
      update((old) => ({ ...old, stations: next }));
      setSelected(item.id);
      setDialog(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function attach(file: File | undefined, kind: "video" | "document") {
    // 先上传受控文件，再保存业务引用；若引用保存失败则回收刚上传的文件。
    if (!file || !station) return;
    try {
      if (kind === "video" && !/\.(mp4|webm)$/i.test(file.name))
        throw new Error("视频仅支持 MP4 / WebM");
      if (kind === "document" && !/\.pdf$/i.test(file.name))
        throw new Error("文档仅支持 PDF");
      if (
        kind === "document" &&
        !(await file.slice(0, 5).text()).startsWith("%PDF-")
      )
        throw new Error("无效 PDF 文件");
      const blobId = await storeFile(sceneId, file);
      if (!alive.current) {
        await deleteFile(sceneId, blobId);
        return;
      }
      await persistUploadedFile(sceneId, blobId, () =>
        update((old) => ({
          ...old,
          assets: [
            ...old.assets,
            {
              id: crypto.randomUUID(),
              name: file.name,
              fileName: file.name,
              kind,
              blobId,
              stationId: station.id,
              size: file.size,
            },
          ],
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="business-page station-page">
      <aside className="station-catalog panel">
        <div className="panel-heading">
          <strong>点位目录</strong>
          <span>{data.stations.length} 个</span>
        </div>
        <div className="panel-body">
          <p className="muted">搜索、筛选并选择站点</p>
          <UiInput
            aria-label="搜索点位"
            placeholder="点位名称/编码"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filter-chips">
            {["全部", "气象站", "雷达", "风险点"].map((t) => (
              <UiButton
                key={t}
                className={t === category ? "active" : ""}
                onClick={() => setCategory(t)}
              >
                {t}
              </UiButton>
            ))}
          </div>
          <div className="tool-grid">
            <UiButton
              className="primary"
              onClick={() => {
                setIsNew(true);
                setError("");
                setDialog({
                  id: "",
                  name: "",
                  sceneId,
                  lon: 0,
                  lat: 0,
                  elevationM: 0,
                  type: types[0],
                  source: "mock",
                  status: "运行正常",
                });
              }}
            >
              录入站点
            </UiButton>
            <UiUpload
              className="file-button"
              accept=".csv"
              aria-label="导入站点CSV"
              onChange={async (e) => {
                try {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2e6)
                    throw new Error("导入文件不得超过 2MB");
                  setReport(
                    parseStationCsv(
                      await file.text(),
                      data.stations,
                      sceneId,
                    ),
                  );
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              批量导入
            </UiUpload>
            <UiButton
              onClick={() =>
                download(
                  "站点导入模板.csv",
                  "\uFEFF站点编码,名称,经度,纬度,高程,类型\nDEMO-001,示例站,108.94,34.34,400,国家有人站\n",
                )
              }
            >
              下载模板
            </UiButton>
            <UiButton
              onClick={() =>
                download(
                  "站点导出.csv",
                  "\uFEFF站点编码,名称,经度,纬度,高程,类型\n" +
                    data.stations
                      .map((s) =>
                        [s.id, s.name, s.lon, s.lat, s.elevationM, s.type]
                          .map((v) => csvCell(v))
                          .join(","),
                      )
                      .join("\n"),
                )
              }
            >
              导出站点
            </UiButton>
          </div>
          <div className="catalog-scroll">
            <UiList
              className="station-catalog-list"
              split={false}
              dataSource={data.stations.filter(
                (s) =>
                  (!query || s.id.includes(query) || s.name.includes(query)) &&
                  (category === "全部" ||
                    (category === "气象站" &&
                      !s.type.includes("雷达") &&
                      !s.type.includes("风险")) ||
                    (category === "雷达" && s.type.includes("雷达")) ||
                    (category === "风险点" && s.type.includes("风险"))),
              )}
              renderItem={(s, i) => (
                <UiList.Item className="station-catalog-item" key={s.id}>
                <UiButton
                  className={`catalog-card ${station?.id === s.id ? "active" : ""}`}
                  onClick={() => setSelected(s.id)}
                >
                  <span>
                    {String(i + 1).padStart(2, "0")} {s.name}
                  </span>
                  <small>
                    {s.id} · {s.type}
                  </small>
                </UiButton>
                </UiList.Item>
              )}
            />
          </div>
          <p className="data-disclaimer">
            本地演示资料；导入先预校验，重复编码默认跳过。CSV 不超过 2MB。
          </p>
        </div>
      </aside>
      <section className="station-profile panel">
        <div className="panel-heading">
          <strong>{station?.name ?? "站点档案"}</strong>
          <span>本地演示</span>
        </div>
        <div className="panel-body">
          {draft ? (
            <>
              <h3>基础档案和空间位置</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save(draft, station.id);
                }}
              >
                <StationFields value={draft} onChange={setDraft} readonlyId />
                <h3>三维模型绑定（可选）</h3>
                <div className="inline-fields">
                  <UiSelect
                    aria-label="站点模型"
                    value={draft.modelId ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        modelId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">未绑定模型</option>
                    {data.assets
                      .filter((a) => a.kind === "model")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </UiSelect>
                  <UiButton htmlType="button" onClick={() => setModels(true)}>
                    上传/绑定
                  </UiButton>
                </div>
                <label>
                  站点默认巡航视角（可选）
                  <UiSelect
                    value={draft.bookmarkId ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        bookmarkId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">暂不设置，漫游时再设置</option>
                    {data.bookmarks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </UiSelect>
                </label>
                <div className="tool-grid">
                  <UiButton htmlType="button" onClick={() => locate(station)}>
                    定位到地图
                  </UiButton>
                  <UiButton className="primary" type="submit">保存修改</UiButton>
                </div>
              </form>
              <ObservationCard station={station} time={time} />
            </>
          ) : (
            <p className="empty-state">录入或选择站点</p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      </section>
      <section className="station-assets">
        <section className="panel">
          <div className="panel-heading">
            <strong>点位关联资料</strong>
          </div>
          <div className="panel-body">
            <p className="muted">视频讲解与维护文件按点位 ID 绑定</p>
            {data.assets
              .filter((a) => a.stationId === station?.id && a.kind !== "model")
              .map((a) => (
                <div key={a.id} className="asset-row">
                  <span className="model-badge">
                    {a.kind === "video" ? <Icon name="video" size={16} /> : "PDF"}
                  </span>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {(a.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                      {a.blobId.startsWith("srv_")
                        ? "服务器文件"
                        : "旧浏览器文件"}
                    </small>
                  </div>
                  {!a.blobId.startsWith("srv_") && (
                    <UiButton
                      onClick={() => {
                        void migrateFile(sceneId, a.blobId, a.fileName)
                          .then((blobId) =>
                            persistUploadedFile(sceneId, blobId, () =>
                              update((old) => ({
                                ...old,
                                assets: old.assets.map((x) =>
                                  x.id === a.id ? { ...x, blobId } : x,
                                ),
                              })),
                            ),
                          )
                          .catch((e) => setError(e.message));
                      }}
                    >
                      迁移到服务器
                    </UiButton>
                  )}
                  <UiButton
                    onClick={() => {
                      const request = ++viewRequest.current;
                      void readFile(sceneId, a.blobId)
                        .then((blob) => {
                          if (!alive.current || request !== viewRequest.current)
                            return;
                          setViewing({
                            url: URL.createObjectURL(blob),
                            asset: a,
                          });
                        })
                        .catch((e) => {
                          if (alive.current) setError(e.message);
                        });
                    }}
                  >
                    {a.kind === "video" ? "播放视频" : "打开文档"}
                  </UiButton>
                  <UiButton
                    onClick={() =>
                      void update((old) => ({
                        ...old,
                        assets: old.assets.filter((x) => x.id !== a.id),
                      }))
                        .then((saved) => {
                          if (saved) return deleteFile(sceneId, a.blobId);
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    移除
                  </UiButton>
                </div>
              ))}
            {!data.assets.some((a) => a.stationId === station?.id) && (
              <p className="empty-state">尚未关联视频或文档</p>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <strong>资料维护与关联</strong>
          </div>
          <div className="panel-body">
            <p className="muted">
              最大 100MB。新文件保存于服务器，按租户和地区授权读取。
            </p>
            <FileMaintenance sceneId={sceneId} />
            <div className="tool-grid">
              <UiUpload
                className="file-button"
                aria-label="上传点位视频"
                accept=".mp4,.webm"
                disabled={!station}
                onChange={(e) => void attach(e.target.files?.[0], "video")}
              >
                上传视频
              </UiUpload>
              <UiUpload
                className="file-button"
                aria-label="上传点位文档"
                accept=".pdf"
                disabled={!station}
                onChange={(e) => void attach(e.target.files?.[0], "document")}
              >
                上传 PDF
              </UiUpload>
            </div>
          </div>
        </section>
      </section>
      {dialog && (
        <Modal
          title={isNew ? "录入站点" : "编辑站点"}
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                parseCoordinate(String(dialog.lon), String(dialog.lat));
                save(dialog, isNew ? undefined : dialog.id);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <StationFields value={dialog} onChange={setDialog} />
            <label>
              三维模型绑定（可选）
              <UiSelect
                value={dialog.modelId ?? ""}
                onChange={(e) =>
                  setDialog({ ...dialog, modelId: e.target.value || undefined })
                }
              >
                <option value="">未绑定模型</option>
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
              默认巡航视角（选填）
              <UiSelect
                value={dialog.bookmarkId ?? ""}
                onChange={(e) =>
                  setDialog({
                    ...dialog,
                    bookmarkId: e.target.value || undefined,
                  })
                }
              >
                <option value="">暂不设置</option>
                {data.bookmarks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </UiSelect>
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <UiButton className="primary" type="submit">保存站点</UiButton>
          </form>
        </Modal>
      )}
      {models && (dialog ?? station) && (
        <ModelManager
          business={business}
          map={map}
          lon={(dialog ?? station).lon}
          lat={(dialog ?? station).lat}
          height={(dialog ?? station).elevationM}
          onClose={() => setModels(false)}
          onChoose={(id) => {
            if (dialog) setDialog({ ...dialog, modelId: id });
            else if (draft) setDraft({ ...draft, modelId: id });
          }}
        />
      )}
      {report && (
        <Modal title="站点导入预校验" onClose={() => setReport(null)}>
          <p>
            可导入 {report.imported.length} 条，重复跳过 {report.skipped}{" "}
            条，错误 {report.errors.length} 条。
          </p>
          {report.errors.map((e) => (
            <p key={e.line} className="error-text">
              第 {e.line} 行：{e.message}
            </p>
          ))}
          <UiButton
            className="primary"
            disabled={!report.imported.length}
            onClick={() => {
              update((old) => ({
                ...old,
                stations: [
                  ...old.stations,
                  ...report.imported.filter(
                    (s) => !old.stations.some((x) => x.id === s.id),
                  ),
                ],
              }));
              setReport(null);
            }}
          >
            确认导入
          </UiButton>
        </Modal>
      )}
      {viewing && (
        <Modal
          title={viewing.asset.name}
          onClose={() => {
            viewRequest.current++;
            setViewing(null);
          }}
        >
          {viewing.asset.kind === "video" ? (
            <video controls autoPlay src={viewing.url} />
          ) : (
            <object
              type="application/pdf"
              data={viewing.url}
              className="pdf-viewer"
            >
              <a href={viewing.url} download={viewing.asset.fileName}>
                下载 PDF
              </a>
            </object>
          )}
        </Modal>
      )}
    </section>
  );
}
function StationFields({
  value,
  onChange,
  readonlyId = false,
}: {
  value: ManagedStation;
  onChange: (s: ManagedStation) => void;
  readonlyId?: boolean;
}) {
  return (
    <div className="form-grid">
      <label>
        站点名称
        <UiInput
          required
          maxLength={80}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        点位编码
        <UiInput
          required
          maxLength={40}
          readOnly={readonlyId}
          value={value.id}
          onChange={(e) => onChange({ ...value, id: e.target.value })}
        />
      </label>
      <label>
        站点类型
        <UiSelect
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value })}
        >
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </UiSelect>
      </label>
      <label>
        所属行政区
        <UiInput
          value={value.region ?? ""}
          onChange={(e) => onChange({ ...value, region: e.target.value })}
        />
      </label>
      <label>
        经度(°)
        <UiInput
          required
          type="number"
          step="any"
          min={-180}
          max={180}
          value={Number.isFinite(value.lon) ? value.lon : ""}
          onChange={(e) =>
            onChange({
              ...value,
              lon: e.target.value === "" ? NaN : Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        纬度(°)
        <UiInput
          required
          type="number"
          step="any"
          min={-90}
          max={90}
          value={Number.isFinite(value.lat) ? value.lat : ""}
          onChange={(e) =>
            onChange({
              ...value,
              lat: e.target.value === "" ? NaN : Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        高程(m)
        <UiInput
          required
          type="number"
          step="any"
          value={value.elevationM}
          onChange={(e) =>
            onChange({ ...value, elevationM: Number(e.target.value) })
          }
        />
      </label>
      <label>
        维护单位
        <UiInput
          value={value.maintenance ?? ""}
          onChange={(e) => onChange({ ...value, maintenance: e.target.value })}
        />
      </label>
      <label>
        站点状态
        <UiSelect
          value={value.status ?? "运行正常"}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
        >
          <option>运行正常</option>
          <option>维护中</option>
          <option>数据更新中</option>
          <option>停用</option>
        </UiSelect>
      </label>
    </div>
  );
}
function ObservationCard({
  station,
  time,
}: {
  station: ManagedStation;
  time: string;
}) {
  const [frames, setFrames] = useState<DataFrame[]>([]),
    [element, setElement] = useState<
      "temperatureC" | "rainfallMm" | "windSpeedMs"
    >("temperatureC"),
    [error, setError] = useState("");
  useEffect(() => {
    const ctrl = new AbortController();
    setFrames([]);
    void api
      .times("stations", station.sceneId, ctrl.signal)
      .then((times) =>
        Promise.all(
          times
            .slice(-24)
            .map((t) => api.data("stations", station.sceneId, t, ctrl.signal)),
        ),
      )
      .then(setFrames)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
    return () => ctrl.abort();
  }, [station.sceneId]);
  const row = frames
    .find((f) => f.observedAt === time)
    ?.observations.find((o) => o.stationId === station.id);
  const values = frames.map(
    (f) =>
      f.observations.find((o) => o.stationId === station.id)?.elements[
        element
      ] ?? null,
  );
  const nums = values.filter((v): v is number => v !== null);
  const min = Math.min(...nums),
    max = Math.max(...nums);
  const points = values
    .map((v, i) =>
      v === null
        ? ""
        : `${20 + i * 40},${110 - ((v - min) / (max - min || 1)) * 80}`,
    )
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <h3>
        最新观测摘要 <span className="tag">Mock · {beijingTime(time)}</span>
      </h3>
      <div className="form-grid metrics-grid">
        {(
          [
            ["temperatureC", "气温", "°C"],
            ["rainfallMm", "1 小时降水", "mm"],
            ["windSpeedMs", "风速", "m/s"],
          ] as const
        ).map(([key, label, unit]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>
              {row?.elements[key] ?? "—"} {unit}
            </strong>
          </div>
        ))}
      </div>
      <div className="chart-heading">
        <h3>站点数据变化</h3>
        <UiSelect
          aria-label="趋势要素"
          value={element}
          onChange={(e) => setElement(e.target.value as typeof element)}
        >
          <option value="temperatureC">气温(°C)</option>
          <option value="rainfallMm">降水(mm)</option>
          <option value="windSpeedMs">风速(m/s)</option>
        </UiSelect>
      </div>
      {nums.length ? (
        <svg
          className="trend-chart"
          viewBox="0 0 520 140"
          role="img"
          aria-label="站点示例观测趋势"
        >
          <path
            d="M20 30H500M20 70H500M20 110H500"
            stroke="#dbe3ec"
            fill="none"
          />
          <polyline
            points={points}
            stroke="#1263c4"
            strokeWidth="2"
            fill="none"
          />
          <text x="20" y="135">
            00:00
          </text>
          <text x="460" y="135">
            12:00
          </text>
          <text x="20" y="18">
            {max.toFixed(1)}
          </text>
        </svg>
      ) : (
        <p className="empty-state">{error || "该点位尚无观测资料"}</p>
      )}
    </>
  );
}
