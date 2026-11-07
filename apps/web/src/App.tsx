import { lazy, Suspense, useState } from "react";
import { Login } from "./Login";
const Workbench = lazy(() => import("./Workbench"));
export function App() {
  const [entered, setEntered] = useState(false);
  return entered ? (
    <Suspense
      fallback={<div className="loading-screen">正在加载地图工作台…</div>}
    >
      <Workbench onExit={() => setEntered(false)} />
    </Suspense>
  ) : (
    <Login onEnter={() => setEntered(true)} />
  );
}
