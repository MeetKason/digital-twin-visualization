import { parseBusinessData, type BusinessData } from "@dtv/contracts";
import { useEffect, useRef, useState } from "react";
import { businessApi, type BusinessRevision } from "../api";
const empty = (): BusinessData => ({
  version: 1,
  stations: [],
  bookmarks: [],
  assets: [],
  plans: [],
  users: [],
});
export function useBusiness(sceneId: string) {
  const [data, setData] = useState<BusinessData>(empty),
    [error, setError] = useState(""),
    [status, setStatus] = useState("正在加载服务端资料"),
    [legacy, setLegacy] = useState(false);
  const ref = useRef<BusinessRevision | null>(null),
    confirmed = useRef<BusinessRevision | null>(null),
    queue = useRef<Promise<void>>(Promise.resolve()),
    alive = useRef(true),
    blocked = useRef(false),
    pending = useRef(0);
  useEffect(() => {
    alive.current = true;
    const ctrl = new AbortController();
    void businessApi
      .get(sceneId, ctrl.signal)
      .then((state) => {
        ref.current = state;
        confirmed.current = state;
        setData(state.data);
        setStatus("服务端资料已加载");
        setLegacy(
          !!localStorage.getItem(`dtv:business:v1:${sceneId}`) &&
            state.revision === 0,
        );
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e.message);
          setStatus("加载失败");
        }
      });
    return () => {
      alive.current = false;
      ctrl.abort();
    };
  }, [sceneId]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (pending.current > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  function update(change: (old: BusinessData) => BusinessData) {
    if (!ref.current || blocked.current) {
      setError("资料未加载或保存已失败，请先重新加载");
      return;
    }
    let next: BusinessData;
    try {
      next = parseBusinessData(change(ref.current.data), sceneId);
    } catch {
      setError("字段不完整或包含无效数字，未保存");
      return;
    }
    const scope = ref.current.owner;
    ref.current = { ...ref.current, data: next };
    setData(next);
    setStatus("正在保存到服务端…");
    pending.current++;
    queue.current = queue.current
      .then(async () => {
        if (blocked.current) return;
        try {
          const response = await businessApi.put(sceneId, {
            revision: confirmed.current!.revision,
            owner: scope,
            data: next,
          });
          confirmed.current = { ...response, owner: scope };
          if (alive.current) {
            setError("");
            if (pending.current === 1) setStatus("服务端已保存");
          }
        } catch (e) {
          blocked.current = true;
          if (alive.current) {
            setError(`${(e as Error).message}；本次未保存，请重新加载后重试`);
            setStatus("保存失败");
            if (confirmed.current) {
              ref.current = confirmed.current;
              setData(confirmed.current.data);
            }
          }
        } finally {
          pending.current--;
        }
      })
      .then(() => {
        if (blocked.current && pending.current > 0) pending.current = 0;
      });
  }
  async function reload() {
    try {
      await queue.current;
      const state = await businessApi.get(sceneId);
      ref.current = state;
      confirmed.current = state;
      blocked.current = false;
      setData(state.data);
      setError("");
      setStatus("服务端资料已加载");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function migrateLocal() {
    try {
      const value = parseBusinessData(
        JSON.parse(
          localStorage.getItem(`dtv:business:v1:${sceneId}`) ?? "null",
        ),
        sceneId,
      );
      update(() => value);
      setLegacy(false);
    } catch {
      setError("本地资料校验失败，原资料未删除");
    }
  }
  return { data, update, error, status, reload, legacy, migrateLocal, sceneId };
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
