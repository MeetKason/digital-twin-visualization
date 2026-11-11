import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Select,
  Space,
  Statistic,
  Tag,
} from "antd";
import type { MapFacade, RouteExtension, WidgetExtension } from "@dtv/sdk";
import type { useExtensions } from "../useExtensions";
/** 插件只提交文本和受限动作，最终交互与视觉使用宿主Ant组件。 */
export function PluginPage({
  route,
  map,
}: {
  route: RouteExtension;
  map: MapFacade | null;
}) {
  return (
    <section className="business-page plugin-page" aria-label={route.title}>
      <Card
        title={
          <Space>
            {route.title}
            <Tag>插件页面</Tag>
          </Space>
        }
      >
        <p>{route.description}</p>
        <Descriptions
          bordered
          column={1}
          items={route.rows.map((row, index) => ({
            key: index,
            label: row.label,
            children: row.value,
          }))}
        />
        {route.action && (
          <Button
            className="plugin-action"
            onClick={() =>
              map?.flyTo(
                route.action!.lon,
                route.action!.lat,
                route.action!.height,
              )
            }
          >
            {route.action.label}
          </Button>
        )}
      </Card>
    </section>
  );
}
export function PluginWidgets({
  widgets,
  map,
}: {
  widgets: WidgetExtension[];
  map: MapFacade | null;
}) {
  return (
    <aside className="plugin-widgets" aria-label="插件Widget">
      {widgets.map((widget) => (
        <Card key={widget.id} size="small" title={widget.title}>
          <Statistic value={widget.value} />
          <p>{widget.description}</p>
          {widget.action && (
            <Button
              size="small"
              onClick={() =>
                map?.flyTo(
                  widget.action!.lon,
                  widget.action!.lat,
                  widget.action!.height,
                )
              }
            >
              {widget.action.label}
            </Button>
          )}
        </Card>
      ))}
    </aside>
  );
}
export function PluginManagement({
  extension,
}: {
  extension: ReturnType<typeof useExtensions>;
}) {
  return (
    <section aria-label="插件管理" className="plugin-management">
      <Alert
        type="info"
        showIcon
        message="插件必须通过签名、完整性与SDK校验，隔离运行；菜单和Widget由宿主Ant组件渲染，数据Provider只能读取当前账号授权的产品。"
      />
      <Space wrap>
        <Select
          aria-label="管理插件选择"
          value={extension.selectedId || undefined}
          disabled={extension.busy || extension.discovering}
          style={{ minWidth: 260 }}
          options={extension.plugins.map((p) => ({
            value: p.id,
            label: `${p.id} · ${p.version}`,
          }))}
          onChange={extension.setSelectedId}
        />
        <Button
          type="primary"
          disabled={!extension.selected || extension.busy}
          onClick={() => void extension.toggle()}
        >
          {extension.installed ? "卸载选中插件" : "安装选中插件"}
        </Button>
      </Space>
      <p>
        已注册：菜单 {extension.routes.length} 项、Widget{" "}
        {extension.widgets.length} 项、图层 {extension.layers.length} 项
      </p>
      {!extension.plugins.length && (
        <Empty
          description={
            extension.discovering
              ? "正在发现插件"
              : "没有可用插件或未获插件授权"
          }
        />
      )}{" "}
      {extension.error && (
        <Alert type="error" showIcon message={extension.error} />
      )}
    </section>
  );
}
