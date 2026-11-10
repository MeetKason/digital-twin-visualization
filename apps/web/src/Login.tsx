import { UiButton, UiInput } from "./ui/controls";
import { useState } from "react";
import { authApi } from "./api";
import { Icon } from "./Icon";
export function Login({
  onEnter,
  demoEnabled,
  initialMessage,
}: {
  onEnter: () => void;
  demoEnabled: boolean;
  initialMessage: string;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(demo = false) {
    setBusy(true);
    setMessage("");
    try {
      if (demo) await authApi.demo();
      else await authApi.login(username, password);
      onEnter();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-background" aria-hidden="true">
        <img className="earth" src="/design/eb0d0.png" alt="" />
        <img className="atmosphere" src="/design/04b64.png" alt="" />
        <img className="clouds" src="/design/79f6c.png" alt="" />
      </div>
      <section className="login-card">
        <h1>数字孪生可视化系统</h1>
        <p className="english-name">Digital Twin Visualization</p>
        <div className="login-field">
          <Icon name="user" size={24} />
          <UiInput
            aria-label="账号"
            placeholder="请输入账号"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="login-field">
          <Icon name="password" size={24} />
          <UiInput
            aria-label="密码"
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <UiButton
          className="primary login-submit"
          disabled={busy || !username || !password}
          onClick={() => void submit()}
        >
          登录
        </UiButton>
        {demoEnabled && (
          <UiButton
            className="login-submit"
            disabled={busy}
            onClick={() => void submit(true)}
          >
            进入演示系统
          </UiButton>
        )}
        <UiButton
          className="text-button"
          onClick={() =>
            setMessage(
              "账号由部署管理员通过服务端配置开通。密码不保存在浏览器。演示入口使用独立演示租户。",
            )
          }
        >
          账号与访问说明
        </UiButton>
        <p className="login-note">服务器会话 · 示例气象数据 · 非业务实况</p>
        {message && (
          <p role="status" className="access-note">
            {message}
          </p>
        )}
      </section>
      <footer className="login-footer">
        Digital Twin Visualization · 数字孪生可视化系统
      </footer>
    </main>
  );
}
