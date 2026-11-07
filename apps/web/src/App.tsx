import { lazy, Suspense, useEffect, useState } from "react";
import { Login } from "./Login";
import { authApi } from "./api";
const Workbench = lazy(() => import("./Workbench"));
export function App() {
  const [entered, setEntered] = useState(false),
    [loading, setLoading] = useState(true),
    [demoEnabled, setDemoEnabled] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void authApi
      .session()
      .then((s) => {
        setEntered(!!s.user);
        setDemoEnabled(s.demoEnabled);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function exit() {
    try {
      await authApi.logout();
      setEntered(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading) return <div className="loading-screen">正在检查会话…</div>;
  return entered ? (
    <Suspense
      fallback={<div className="loading-screen">正在加载地图工作台…</div>}
    >
      {error && <p role="alert">{error}</p>}
      <Workbench onExit={() => void exit()} />
    </Suspense>
  ) : (
    <Login
      demoEnabled={demoEnabled}
      onEnter={() => setEntered(true)}
      initialMessage={error}
    />
  );
}
