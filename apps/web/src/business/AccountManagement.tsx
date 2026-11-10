import { useCallback, useEffect, useState } from "react";
import { accountAdminApi, type ManagedAccount } from "../api";

const scenes = ["xian", "taiyuan", "chengdu"] as const;
const sceneNames: Record<(typeof scenes)[number], string> = {
  xian: "西安",
  taiyuan: "太原",
  chengdu: "成都",
};
const roles: Record<ManagedAccount["role"], string> = {
  admin: "管理员",
  editor: "编辑员",
  viewer: "只读",
};
function sceneInput(value: string[], onChange: (next: string[]) => void) {
  return (
    <fieldset>
      <legend>授权地区</legend>
      {scenes.map((scene) => (
        <label className="account-scene" key={scene}>
          <input
            type="checkbox"
            checked={value.includes(scene)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, scene]
                  : value.filter((x) => x !== scene),
              )
            }
          />
          {sceneNames[scene]}
        </label>
      ))}
    </fieldset>
  );
}

export function AccountManagement() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    id: "",
    tenantId: "default",
    role: "viewer" as ManagedAccount["role"],
    scenes: ["xian"],
    password: "",
  });
  const refresh = useCallback(async () => {
    // 用户清单只从管理员 API 读取，浏览器业务资料不参与身份授权。
    try {
      setAccounts(await accountAdminApi.list());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function run(action: () => Promise<unknown>, message: string) {
    // 统一处理账号变更的忙碌态、服务端错误和成功后的列表刷新。
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-management">
      <p className="data-disclaimer">
        这里管理服务器真实登录账号、角色和地区授权。密码只在新建或重置时提交，服务端仅保存
        scrypt 哈希；禁用账号会立即终止其后续请求。
      </p>
      <div className="account-toolbar">
        <button className="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "取消新增" : "新增登录账号"}
        </button>
        <button onClick={() => void refresh()}>刷新</button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-text">
          {notice}
        </p>
      )}
      {creating && (
        <form
          className="account-create"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await accountAdminApi.create(draft);
              setCreating(false);
              setDraft({
                id: "",
                tenantId: "default",
                role: "viewer",
                scenes: ["xian"],
                password: "",
              });
            }, "账号已创建");
          }}
        >
          <label>
            账号 ID
            <input
              required
              minLength={2}
              maxLength={64}
              pattern="[A-Za-z0-9._-]+"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            />
          </label>
          <label>
            租户 ID
            <input
              required
              maxLength={64}
              value={draft.tenantId}
              onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })}
            />
          </label>
          <label>
            角色
            <select
              value={draft.role}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  role: e.target.value as ManagedAccount["role"],
                })
              }
            >
              {Object.entries(roles).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {sceneInput(draft.scenes, (next) =>
            setDraft({ ...draft, scenes: next }),
          )}
          <label>
            初始密码（至少 12 位）
            <input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            />
          </label>
          <button
            className="primary"
            disabled={busy || draft.scenes.length === 0}
          >
            创建账号
          </button>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>租户</th>
              <th>角色</th>
              <th>地区授权</th>
              <th>状态</th>
              <th>账号操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                busy={busy}
                onSave={(body) =>
                  run(
                    () => accountAdminApi.update(account.id, body),
                    "账号权限已更新",
                  )
                }
                onReset={(password) =>
                  run(
                    () => accountAdminApi.resetPassword(account.id, password),
                    "密码已重置，原会话已失效",
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
      {!accounts.length && !error && <p className="muted">暂无账号。</p>}
    </div>
  );
}
function AccountRow({
  account,
  busy,
  onSave,
  onReset,
}: {
  account: ManagedAccount;
  busy: boolean;
  onSave: (body: Omit<ManagedAccount, "id">) => void;
  onReset: (password: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [password, setPassword] = useState(""),
    [draft, setDraft] = useState({
      tenantId: account.tenantId,
      role: account.role,
      scenes: account.scenes,
      disabled: !!account.disabled,
    });
  useEffect(
    () =>
      setDraft({
        tenantId: account.tenantId,
        role: account.role,
        scenes: account.scenes,
        disabled: !!account.disabled,
      }),
    [account],
  );
  const persist = () => onSave(draft);
  return (
    <tr>
      <td>{account.id}</td>
      <td>
        {editing ? (
          <input
            aria-label={`${account.id} 租户`}
            value={draft.tenantId}
            onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })}
          />
        ) : (
          account.tenantId
        )}
      </td>
      <td>
        {editing ? (
          <select
            aria-label={`${account.id} 角色`}
            value={draft.role}
            onChange={(e) =>
              setDraft({
                ...draft,
                role: e.target.value as ManagedAccount["role"],
              })
            }
          >
            {Object.entries(roles).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          roles[account.role]
        )}
      </td>
      <td>
        {editing
          ? sceneInput(draft.scenes, (scenes) => setDraft({ ...draft, scenes }))
          : account.scenes
              .map((s) => sceneNames[s as keyof typeof sceneNames] ?? s)
              .join("、")}
      </td>
      <td>{draft.disabled ? "停用" : "启用"}</td>
      <td className="account-actions">
        {editing ? (
          <>
            <button
              disabled={busy || !draft.scenes.length || !draft.tenantId.trim()}
              onClick={() => {
                persist();
                setEditing(false);
              }}
            >
              保存
            </button>
            <button
              onClick={() => {
                setDraft({
                  tenantId: account.tenantId,
                  role: account.role,
                  scenes: account.scenes,
                  disabled: !!account.disabled,
                });
                setEditing(false);
              }}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button disabled={busy} onClick={() => setEditing(true)}>
              编辑权限
            </button>
            <button
              disabled={busy}
              onClick={() => onSave({ ...draft, disabled: !draft.disabled })}
            >
              {draft.disabled ? "启用" : "停用"}
            </button>
          </>
        )}
        <details>
          <summary>重置密码</summary>
          <label className="password-reset">
            新密码
            <input
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            disabled={busy || password.length < 12}
            onClick={() => {
              onReset(password);
              setPassword("");
            }}
          >
            确认重置
          </button>
        </details>
      </td>
    </tr>
  );
}
