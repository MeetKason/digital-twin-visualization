import { useState } from "react";
export function Login({ onEnter }: { onEnter: () => void }) {
  const [message, setMessage] = useState("");
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
          <img src="/design/35798.svg" alt="" />
          <input aria-label="演示账号" value="demo · 演示用户" readOnly />
        </div>
        <div className="login-field">
          <img src="/design/2cecb.svg" alt="" />
          <span>演示环境，无需输入生产凭据</span>
        </div>
        <button className="primary login-submit" onClick={onEnter}>
          进入演示系统
        </button>
        <button
          className="text-button"
          onClick={() =>
            setMessage(
              "当前为本地演示入口。正式账号与密码找回由部署单位接入身份服务。",
            )
          }
        >
          账号与访问说明
        </button>
        <p className="login-note">本地演示 · 示例数据 · 非业务实况</p>
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
