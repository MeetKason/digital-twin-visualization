import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  type TableColumnsType,
} from "antd";
import {
  LAYERS,
  MenuIds,
  SettingsSectionIds,
  SettingsSectionNames,
  ScenarioPackSchema,
  type ScenarioPack,
  type ScenarioRevision,
} from "@dtv/contracts";
import { authApi, scenarioApi } from "../api";
import { download } from "./useBusiness";
import { beijingTime } from "../time";
const names: Record<(typeof MenuIds)[number], string> = {
  home: "总览地图",
  roam: "路径漫游",
  station: "点位管理",
  weather: "气象专题",
  device: "设备监控",
  settings: "系统管理",
};
const defaultUi = () => ({
  menus: [...MenuIds],
  settingsSections: [...SettingsSectionIds],
  theme: { primary: "#1263c4", navy: "#1c466c" },
  layout: { panelWidth: 264, timelineHeight: 112 },
});

/** 包只作声明式配置；在浏览器和服务端分别校验，导入失败保留当前草稿。 */
export function ScenarioManager({
  sceneId,
  onApplied,
  businessSaving,
}: {
  sceneId: string;
  onApplied: () => Promise<void>;
  businessSaving: boolean;
}) {
  const [selected, setSelected] = useState(sceneId);
  const [authorized, setAuthorized] = useState<string[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [canEditSettingsSections, setCanEditSettingsSections] = useState(false);
  const [record, setRecord] = useState<ScenarioRevision | null>(null);
  const [pack, setPack] = useState<ScenarioPack | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    alive.current = true;
    void authApi
      .session()
      .then(({ user }) => {
        if (!alive.current) return;
        setAllowed(user?.role === "admin");
        setCanEditSettingsSections(!!user?.platformAdmin || user?.kind === "demo");
        setAuthorized(user?.scenes ?? []);
      })
      .catch((e: Error) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setRecord(null);
    setPack(null);
    setDirty(false);
    setNotice("");
    setError("");
    void scenarioApi
      .read(selected, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setRecord(next);
          setPack(next.data.draft);
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected, allowed]);
  const validation = pack ? ScenarioPackSchema.safeParse(pack) : null;
  const valid = validation?.success ?? false;
  const validationMessage =
    validation?.success === false
      ? validation.error.issues.find((issue) => issue.code === "custom")
          ?.message
      : undefined;
  const edit = (change: (current: ScenarioPack) => ScenarioPack) => {
    if (!pack || busy) return;
    setPack(change(pack));
    setDirty(true);
    setNotice("");
  };
  const editScene = (change: Partial<ScenarioPack["scene"]>) =>
    edit((value) => ({ ...value, scene: { ...value.scene, ...change } }));
  const ui = pack?.scene.ui ?? defaultUi();
  async function run(
    action: () => Promise<ScenarioRevision>,
    message: string,
    apply = false,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await action();
      if (!alive.current) return;
      setRecord(next);
      setPack(next.data.draft);
      setDirty(false);
      setNotice(message);
      if (apply) await onApplied();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  type History = ScenarioRevision["data"]["history"][number];
  const columns: TableColumnsType<History> = [
    { title: "配置修订", dataIndex: "revision", width: 100 },
    {
      title: "版本标识",
      render: (_, item) => item.pack.scene.revision,
      width: 140,
    },
    { title: "发布人", dataIndex: "actor", width: 180 },
    {
      title: "发布时间",
      render: (_, item) => beijingTime(item.at),
      width: 180,
    },
    {
      title: "操作",
      width: 160,
      render: (_, item) => (
        <Popconfirm
          title="恢复为新草稿？"
          description="当前草稿将替换为该历史版本，在线配置保持不变。"
          onConfirm={() =>
            record &&
            run(
              () =>
                scenarioApi.restore(selected, record.revision, item.revision),
              "已恢复为新草稿；发布后生效",
            )
          }
        >
          <Button disabled={busy}>恢复为草稿</Button>
        </Popconfirm>
      ),
    },
  ];
  if (!allowed)
    return (
      <Alert
        type="info"
        showIcon
        message="仅管理员可导入、发布或恢复当前租户授权地区的场景包。"
      />
    );
  return (
    <section aria-label="场景包管理" className="scenario-manager">
      <Alert
        type="info"
        showIcon
        message="保存草稿不会影响在线场景；发布后应用菜单、图层、主题和布局。站点、观测和附件保持原有位置与权限；关闭产品图层前请先停用对应采集计划。"
      />
      <Space wrap>
        <label>
          配置地区{" "}
          <Select
            aria-label="配置地区"
            value={selected}
            disabled={busy || dirty}
            options={authorized.map((id) => ({ value: id, label: id }))}
            onChange={setSelected}
            style={{ minWidth: 150 }}
          />
        </label>
        <Upload
          accept=".json,application/json"
          showUploadList={false}
          disabled={busy || !record}
          beforeUpload={async (file) => {
            setBusy(true);
            try {
              if (file.size > 128 * 1024)
                throw new Error("场景包不能超过128KB");
              const parsed = ScenarioPackSchema.parse(
                JSON.parse(await file.text()),
              );
              if (parsed.scene.id !== selected)
                throw new Error("场景包地区ID与当前选择不一致");
              if (alive.current && selectedRef.current === selected) {
                setPack(parsed);
                setDirty(true);
                setError("");
                setNotice("校验通过，尚未保存和发布");
              }
            } catch (e) {
              if (alive.current && selectedRef.current === selected)
                setError(
                  e instanceof Error ? `导入失败：${e.message}` : "导入失败",
                );
            }
            if (alive.current) setBusy(false);
            return false;
          }}
        >
          <Button disabled={busy || !record}>导入场景包</Button>
        </Upload>
        <Button
          disabled={!pack}
          onClick={() =>
            pack &&
            download(
              `${selected}-场景包.json`,
              JSON.stringify(pack, null, 2),
              "application/json",
            )
          }
        >
          导出当前草稿
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            run(() => scenarioApi.read(selected), "已重新加载服务端草稿")
          }
        >
          重新加载草稿
        </Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      {notice && <Alert type="success" showIcon message={notice} />}
      {record && (
        <Descriptions
          size="small"
          bordered
          column={2}
          items={[
            { key: "revision", label: "配置修订", children: record.revision },
            {
              key: "state",
              label: "在线版本",
              children: record.data.published ? (
                <Tag color="green">{record.data.published.scene.revision}</Tag>
              ) : (
                "使用内置配置或尚未发布"
              ),
            },
          ]}
        />
      )}
      {record && !pack && (
        <Button
          disabled={busy}
          onClick={() => {
            setPack({
              formatVersion: 1,
              coreApi: 1,
              description: "",
              scene: {
                id: selected,
                name: selected,
                shortName: selected.slice(0, 20),
                regionCode: "",
                center: [0, 0],
                height: 145000,
                modules: ["station", "weather"],
                revision: "v1",
                source: "mock",
                ui: defaultUi(),
              },
            });
            setDirty(true);
          }}
        >
          新建配置草稿
        </Button>
      )}
      {pack && (
        <fieldset disabled={busy} className="scenario-editor">
          <div className="scenario-grid">
            <label>
              场景名称
              <Input
                aria-label="场景名称"
                value={pack.scene.name}
                maxLength={80}
                onChange={(e) => editScene({ name: e.target.value })}
              />
            </label>
            <label>
              地区简称
              <Input
                aria-label="地区简称"
                value={pack.scene.shortName}
                maxLength={20}
                onChange={(e) => editScene({ shortName: e.target.value })}
              />
            </label>
            <label>
              行政区划代码
              <Input
                aria-label="行政区划代码"
                value={pack.scene.regionCode}
                maxLength={32}
                onChange={(e) => editScene({ regionCode: e.target.value })}
              />
            </label>
            <label>
              版本标识
              <Input
                aria-label="场景版本标识"
                value={pack.scene.revision}
                maxLength={64}
                onChange={(e) => editScene({ revision: e.target.value })}
              />
            </label>
            <label>
              中心经度
              <InputNumber
                aria-label="场景中心经度"
                value={pack.scene.center[0]}
                min={-180}
                max={180}
                onChange={(value) =>
                  editScene({ center: [value ?? 0, pack.scene.center[1]] })
                }
              />
            </label>
            <label>
              中心纬度
              <InputNumber
                aria-label="场景中心纬度"
                value={pack.scene.center[1]}
                min={-90}
                max={90}
                onChange={(value) =>
                  editScene({ center: [pack.scene.center[0], value ?? 0] })
                }
              />
            </label>
            <label>
              场景基准高度（米）
              <InputNumber
                aria-label="场景基准高度"
                value={pack.scene.height}
                min={1000}
                max={10000000}
                onChange={(value) => editScene({ height: value ?? 0 })}
              />
            </label>
            <label>
              边界资源
              <Input
                aria-label="边界资源路径"
                value={pack.scene.boundaryUrl ?? ""}
                placeholder="/geojson/地区代码.geojson"
                onChange={(e) =>
                  editScene({ boundaryUrl: e.target.value || undefined })
                }
              />
            </label>
          </div>
          <div className="scenario-field">
            <span>启用菜单</span>
            <Checkbox.Group
              aria-label="启用菜单"
              options={MenuIds.map((id) => ({
                value: id,
                label: names[id],
                disabled: id === "home" || id === "settings",
              }))}
              value={ui.menus}
              onChange={(menus) =>
                editScene({
                  ui: { ...ui, menus: menus as typeof ui.menus },
                  ...(menus.includes("weather") && pack.scene.enabledLayers
                    ? {
                        enabledLayers: [
                          ...new Set([...pack.scene.enabledLayers, "rainfall"]),
                        ],
                      }
                    : {}),
                })
              }
            />
          </div>
          <div className="scenario-field">
            <span>系统管理子菜单上限</span>
            {!canEditSettingsSections && <span className="muted">仅平台最高管理员可调整</span>}
            <Checkbox.Group
              aria-label="系统管理子菜单上限"
              disabled={!canEditSettingsSections}
              options={SettingsSectionIds.map((id) => ({ value: id, label: SettingsSectionNames[id] }))}
              value={ui.settingsSections ?? [...SettingsSectionIds]}
              onChange={(settingsSections) => editScene({
                ui: { ...ui, settingsSections: settingsSections as typeof ui.settingsSections },
              })}
            />
          </div>
          <Collapse
            items={[
              {
                key: "layers",
                label: "启用图层（基础依赖保留）",
                children: (
                  <Checkbox.Group
                    className="scenario-layer-options"
                    aria-label="启用图层"
                    options={LAYERS.map((layer) => ({
                      value: layer.id,
                      label: layer.name,
                      disabled:
                        ["boundary", "stations", "temperature"].includes(
                          layer.id,
                        ) ||
                        (layer.id === "rainfall" &&
                          ui.menus.includes("weather")),
                    }))}
                    value={
                      pack.scene.enabledLayers ??
                      LAYERS.map((layer) => layer.id)
                    }
                    onChange={(layers) =>
                      editScene({ enabledLayers: layers as string[] })
                    }
                  />
                ),
              },
            ]}
          />
          <div className="scenario-grid">
            <label>
              主色
              <Input
                aria-label="场景主色"
                value={ui.theme.primary}
                maxLength={7}
                onChange={(e) =>
                  editScene({
                    ui: {
                      ...ui,
                      theme: { ...ui.theme, primary: e.target.value },
                    },
                  })
                }
              />
            </label>
            <label>
              导航背景色
              <Input
                aria-label="导航背景色"
                value={ui.theme.navy}
                maxLength={7}
                onChange={(e) =>
                  editScene({
                    ui: { ...ui, theme: { ...ui.theme, navy: e.target.value } },
                  })
                }
              />
            </label>
            <label>
              图层面板宽度
              <InputNumber
                aria-label="图层面板宽度"
                value={ui.layout.panelWidth}
                min={240}
                max={400}
                onChange={(value) =>
                  editScene({
                    ui: {
                      ...ui,
                      layout: { ...ui.layout, panelWidth: value ?? 0 },
                    },
                  })
                }
              />
            </label>
            <label>
              时间轴高度
              <InputNumber
                aria-label="时间轴高度"
                value={ui.layout.timelineHeight}
                min={96}
                max={160}
                onChange={(value) =>
                  editScene({
                    ui: {
                      ...ui,
                      layout: { ...ui.layout, timelineHeight: value ?? 0 },
                    },
                  })
                }
              />
            </label>
          </div>
          <label>
            配置说明
            <Input.TextArea
              aria-label="配置说明"
              value={pack.description}
              maxLength={1000}
              onChange={(e) =>
                edit((value) => ({ ...value, description: e.target.value }))
              }
            />
          </label>
          {!valid && (
            <Alert
              type="warning"
              showIcon
              message={
                validationMessage ??
                "配置尚未通过校验，请检查名称、地址、颜色、尺寸与基础依赖。"
              }
            />
          )}
          <Space wrap>
            <Button
              type="primary"
              disabled={busy || !record || !valid}
              onClick={() =>
                record &&
                run(
                  () => scenarioApi.save(selected, record.revision, pack),
                  "草稿已保存，在线配置尚未改变",
                )
              }
            >
              保存场景草稿
            </Button>
            <Button
              disabled={busy || dirty || !record || !valid || businessSaving}
              onClick={() =>
                record &&
                run(
                  () => scenarioApi.publish(selected, record.revision),
                  "场景配置已发布",
                  true,
                )
              }
            >
              发布已保存草稿
            </Button>
            {dirty && <Tag color="orange">有未保存修改</Tag>}
          </Space>
        </fieldset>
      )}
      <h3>最近20个发布版本</h3>
      <Table
        rowKey="revision"
        size="small"
        columns={columns}
        dataSource={record?.data.history.slice().reverse() ?? []}
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        scroll={{ x: 760 }}
      />
    </section>
  );
}
