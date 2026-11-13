import {
  UiButton,
  UiCard,
  UiInput,
  UiList,
  UiSelect,
  UiUpload,
} from "../ui/controls";
import { AsyncResourceOwner } from "./ownedResource";
import { validateModelFile } from "./modelValidation";
import { createId } from "../id";
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MapFacade, LayerRuntime } from "@dtv/sdk";
import {
  DEMO_TIMES,
  type Asset,
  type SceneConfig,
  type Station,
  type LayerDescriptor,
} from "@dtv/contracts";
import type { Business } from "./useBusiness";
import {
  storeFile,
  readFile,
  deleteFile,
  migrateFile,
  persistUploadedFile,
} from "./files";
import { Modal } from "./Modal";
import { FileMaintenance } from "./FileMaintenance";
export function ModelManager({
  business,
  lon,
  lat,
  height = 0,
  onClose,
  onChoose,
}: {
  business: Business;
  map: MapFacade | null;
  lon: number;
  lat: number;
  height?: number;
  onClose: () => void;
  onChoose?: (id: string) => void;
}) {
  const [modelType, setModelType] = useState("气象设施模型");
  const [name, setName] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [scale, setScale] = useState(1),
    [heading, setHeading] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  async function upload() {
    // 模型先经服务端格式检查进入文件仓库，业务集合再保存该文件引用。
    if (!name.trim()) {
      setError("请输入模型名称");
      return;
    }
    if (!file) {
      setError("请选择模型文件");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError("模型文件不得超过100MB");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await validateModelFile(file);
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(heading))
        throw new Error("缩放和朝向参数无效");
      if (!alive.current) return;
      const blobId = await storeFile(business.sceneId, file);
      if (!alive.current) {
        await deleteFile(business.sceneId, blobId);
        return;
      }
      const asset: Asset = {
        id: createId(),
        name: name.trim(),
        kind: "model",
        blobId,
        fileName: file.name,
        size: file.size,
        scale,
        modelType,
        heading,
      };
      await persistUploadedFile(business.sceneId, blobId, () =>
        business.update((old) => ({ ...old, assets: [...old.assets, asset] })),
      );
      if (!alive.current) return;
      setFile(null);
      setName("");
      onChoose?.(asset.id);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal title="管理/上传模型" onClose={onClose}>
      <p className="muted">
        新模型保存于服务器，最大 100MB；同租户、同地区的授权账号可共用。
      </p>
      <UiCard
        className="asset-list-card"
        size="small"
        styles={{ body: { padding: 4 } }}
      >
        <UiList
          className="asset-list"
          split={false}
          dataSource={business.data.assets.filter((a) => a.kind === "model")}
          locale={{ emptyText: "尚无模型文件" }}
          renderItem={(a) => (
            <UiList.Item key={a.id}>
            <div key={a.id} className="asset-row">
              <span className="model-badge">3D</span>
              <div>
                <strong>{a.name}</strong>
                <small>
                  {a.fileName} ·{" "}
                  {a.blobId.startsWith("srv_") ? "服务器文件" : "旧浏览器文件"}
                </small>
              </div>
              {!a.blobId.startsWith("srv_") && (
                <UiButton
                  onClick={() => {
                    void migrateFile(business.sceneId, a.blobId, a.fileName)
                      .then((blobId) =>
                        persistUploadedFile(business.sceneId, blobId, () =>
                          business.update((old) => ({
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
              <UiButton onClick={() => setPreviewAsset(a)}>地图预览</UiButton>
              {onChoose && (
                <UiButton
                  onClick={() => {
                    onChoose(a.id);
                    onClose();
                  }}
                >
                  绑定
                </UiButton>
              )}
              <UiButton
                onClick={() => {
                  if (
                    business.data.stations.some((s) => s.modelId === a.id) ||
                    business.data.plans.some((p) =>
                      p.points.some((n) => n.modelId === a.id),
                    )
                  ) {
                    setError("模型已被站点或方案引用，不能删除");
                    return;
                  }
                  void business
                    .update((old) => ({
                      ...old,
                      assets: old.assets.filter((x) => x.id !== a.id),
                    }))
                    .then((saved) => {
                      if (saved) return deleteFile(business.sceneId, a.blobId);
                    })
                    .catch((e) => setError(e.message));
                }}
              >
                删除
              </UiButton>
            </div>
            </UiList.Item>
          )}
        />
      </UiCard>
      {previewAsset && (
        <ModelPreview
          sceneId={business.sceneId}
          asset={previewAsset}
          lon={lon}
          lat={lat}
          height={height}
        />
      )}
      <FileMaintenance sceneId={business.sceneId} />
      <h3>上传新模型</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <label>
          模型名称
          <UiInput
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          模型文件（GLB / GLTF）
          <UiUpload
            className="file-button"
            required
            aria-label="选择模型文件"
            accept=".glb,.gltf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          >
            选择模型文件
          </UiUpload>
        </label>
        <label>
          模型类型
          <UiSelect
            value={modelType}
            onChange={(e) => setModelType(e.target.value)}
          >
            <option>气象设施模型</option>
            <option>建筑模型</option>
            <option>其他模型</option>
          </UiSelect>
        </label>
        <div className="form-grid">
          <label>
            缩放比例
            <UiInput
              type="number"
              min=".001"
              step=".001"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
            />
          </label>
          <label>
            模型朝向(°)
            <UiInput
              type="number"
              value={heading}
              onChange={(e) => setHeading(Number(e.target.value))}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <UiButton className="primary" type="submit" disabled={busy}>
          {busy ? "正在保存…" : "登记模型"}
        </UiButton>
      </form>
    </Modal>
  );
}

const PreviewMap = lazy(() => import("../MapView"));
const noLayers: LayerDescriptor[] = [],
  noStations: Station[] = [];
const ignoreStation = () => {};
function ModelPreview({
  sceneId,
  asset,
  lon,
  lat,
  height,
}: {
  sceneId: string;
  asset: Asset;
  lon: number;
  lat: number;
  height: number;
}) {
  const [map, setMap] = useState<MapFacade | null>(null),
    [error, setError] = useState("");
  const owner = useRef(new AsyncResourceOwner());
  const ready = useCallback(
    (_runtime: LayerRuntime, facade: MapFacade) => setMap(facade),
    [],
  );
  const scene = useMemo<SceneConfig>(
    () => ({
      id: "model-preview",
      name: "模型预览",
      shortName: "3D",
      regionCode: "",
      center: [lon, lat],
      height: Math.max(3000, height + 3000),
      modules: [],
      revision: "demo",
      source: "mock",
    }),
    [lon, lat, height],
  );
  useEffect(() => {
    const resource = owner.current;
    return () => resource.dispose();
  }, []);
  useEffect(() => {
    if (!map) return;
    let active = true;
    void owner.current
      .replace(async (current) => {
        const blob = await readFile(sceneId, asset.blobId);
        if (!current()) return;
        const url = URL.createObjectURL(blob);
        try {
          const remove = map.placeModel?.(
            url,
            lon,
            lat,
            height,
            asset.scale ?? 1,
            asset.heading ?? 0,
          );
          return () => {
            remove?.();
            URL.revokeObjectURL(url);
          };
        } catch (e) {
          URL.revokeObjectURL(url);
          throw e;
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [map, asset, lon, lat, height, sceneId]);
  return (
    <>
      <h3>模型预览 · {asset.name}</h3>
      <div className="model-preview-canvas" aria-label="模型三维预览">
        <Suspense fallback={<p>加载预览…</p>}>
          <PreviewMap
            scene={scene}
            stations={noStations}
            layers={noLayers}
            time={DEMO_TIMES[12]}
            onReady={ready}
            onStation={ignoreStation}
          />
        </Suspense>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </>
  );
}
