import { parseBusinessData } from "@dtv/contracts";
import { useEffect, useState } from "react";
import type { BusinessData, Station } from "@dtv/contracts";
const empty = (): BusinessData => ({
  version: 1,
  stations: [],
  bookmarks: [],
  assets: [],
  plans: [],
  users: [{ id: "demo", name: "演示用户", role: "管理员", enabled: true }],
});
export function useBusiness(sceneId: string, stations: Station[]) {
  const [data, setData] = useState<BusinessData>(empty),
    [error, setError] = useState("");
  useEffect(() => {
    if (!stations.length) return;
    try {
      const raw = localStorage.getItem(`dtv:business:v1:${sceneId}`);
      if (raw) {
        const stored = parseBusinessData(JSON.parse(raw), sceneId);
        setData(stored);
      } else
        setData({
          ...empty(),
          stations: stations.map((s, i) => ({
            ...s,
            type: i % 3 === 0 ? "雷达站" : i % 2 ? "国家无人站" : "国家有人站",
            status: "运行正常",
          })),
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : "本地资料读取失败");
      setData({ ...empty(), stations });
    }
  }, [sceneId, stations]);
  function update(change: (old: BusinessData) => BusinessData) {
    setData((old) => {
      const next = change(old);
      try {
        localStorage.setItem(
          `dtv:business:v1:${sceneId}`,
          JSON.stringify(next),
        );
        setError("");
      } catch {
        setError("本地存储失败，请导出资料或清理空间");
      }
      return next;
    });
  }
  return { data, update, error };
}
export type Business = ReturnType<typeof useBusiness>;
export function download(
  name: string,
  text: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
