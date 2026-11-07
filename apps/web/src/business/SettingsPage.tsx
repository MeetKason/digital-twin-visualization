import { useEffect, useState } from "react";
import type { DemoUser } from "@dtv/contracts";
import type { Business } from "./useBusiness";
import { download } from "./useBusiness";
import { Modal } from "./Modal";
const sections = [
  "用户管理",
  "部署服务配置",
  "账号开通/管理",
  "用户与权限",
  "站点数据",
];
export function SettingsPage({ business }: { business: Business }) {
  const [section, setSection] = useState(sections[0]),
    [user, setUser] = useState<DemoUser | null>(null),
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
  const permissions: Record<DemoUser["role"], string> = {
    管理员: "演示配置、点位和漫游方案",
    操作员: "点位、漫游方案、地图和专题",
    只读: "地图、专题、站点浏览",
  };
  return (
    <section className="business-page settings-page">
      <aside className="panel">
        <div className="panel-heading">
          <strong>管理目录</strong>
        </div>
        <div className="panel-body">
          {sections.map((s) => (
            <button
              className={`catalog-card ${s === section ? "active" : ""}`}
              key={s}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </aside>
      <section className="panel">
        <div className="panel-heading">
          <strong>{section}</strong>
          <span>本地演示配置</span>
        </div>
        <div className="panel-body">
          <p className="data-disclaimer">
            此处管理本地演示资料。角色说明不会替代服务端认证和权限校验，不收集或保存生产密码。
          </p>
          {["用户管理", "账号开通/管理", "用户与权限"].includes(section) ? (
            <>
              <button
                className="primary"
                onClick={() =>
                  setUser({
                    id: crypto.randomUUID(),
                    name: "",
                    role: "只读",
                    enabled: true,
                  })
                }
              >
                新增演示用户
              </button>
              <table>
                <thead>
                  <tr>
                    <th>用户名称</th>
                    <th>角色</th>
                    <th>演示权限说明</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {business.data.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.role}</td>
                      <td>{permissions[u.role]}</td>
                      <td>{u.enabled ? "启用" : "停用"}</td>
                      <td>
                        <button onClick={() => setUser({ ...u })}>编辑</button>
                        <button
                          disabled={u.id === "demo"}
                          onClick={() =>
                            business.update((old) => ({
                              ...old,
                              users: old.users.map((x) =>
                                x.id === u.id
                                  ? { ...x, enabled: !x.enabled }
                                  : x,
                              ),
                            }))
                          }
                        >
                          {u.enabled ? "停用" : "启用"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
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
              <button
                onClick={() =>
                  download(
                    "地图配置.json",
                    JSON.stringify(config, null, 2),
                    "application/json",
                  )
                }
              >
                导出当前配置
              </button>
            </>
          ) : (
            <>
              <p>
                站点 {business.data.stations.length} 个 · 方案{" "}
                {business.data.plans.length} 个 · 视角{" "}
                {business.data.bookmarks.length} 个
              </p>
              <button
                onClick={() =>
                  download(
                    "本地演示资料.json",
                    JSON.stringify(business.data, null, 2),
                    "application/json",
                  )
                }
              >
                导出本地演示资料
              </button>
              <p className="muted">
                文件仅为演示数据备份，不包含 IndexedDB
                中的模型和附件二进制文件。
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      </section>
      {user && (
        <Modal title="演示用户" onClose={() => setUser(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              business.update((old) => ({
                ...old,
                users: old.users.some((u) => u.id === user.id)
                  ? old.users.map((u) =>
                      u.id === user.id
                        ? { ...user, name: user.name.trim() }
                        : u,
                    )
                  : [...old.users, { ...user, name: user.name.trim() }],
              }));
              setUser(null);
            }}
          >
            <label>
              用户名称
              <input
                required
                maxLength={50}
                value={user.name}
                onChange={(e) => setUser({ ...user, name: e.target.value })}
              />
            </label>
            <label>
              角色
              <select
                value={user.role}
                onChange={(e) =>
                  setUser({ ...user, role: e.target.value as DemoUser["role"] })
                }
              >
                {Object.keys(permissions).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <p className="muted">{permissions[user.role]}（演示说明）</p>
            <button className="primary">保存用户</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function DevicePage() {
  const [health, setHealth] = useState<{
      status: string;
      mode: string;
      version: string;
    } | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    try {
      const r = await fetch("/api/health");
      if (!r.ok) throw new Error("API 不可用");
      setHealth(await r.json());
      setError("");
    } catch (e) {
      setHealth(null);
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section className="business-page device-page panel">
      <div className="panel-heading">
        <strong>设备监控</strong>
        <button className="mini" onClick={() => void refresh()}>
          刷新状态
        </button>
      </div>
      <div className="panel-body">
        <h2>设备数据源未接入</h2>
        <p className="muted">
          “新电子沙盘”中仅有此菜单，未提供独立设备监控画板。当前不显示虚构设备、视频或运行告警。
        </p>
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
