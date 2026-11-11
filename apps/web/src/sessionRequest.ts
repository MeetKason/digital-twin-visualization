/** 同源受保护请求共用会话状态；公开资源和登录接口不经过此入口。 */
let generation = 0;
let expired = false;
const listeners = new Set<() => void>();
const pending = new Set<AbortController>();

export function activateSession() {
  // 登录成功后开启新一代会话，旧请求迟到的401不能使新会话失效。
  generation++;
  expired = false;
}
/** 主动退出时停止请求，但不把正常退出显示为会话错误。 */
export function closeSession() {
  generation++;
  expired = true;
  for (const request of pending) request.abort();
}
export function subscribeSessionExpired(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export async function sessionFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (expired) throw new Error("登录已失效，请重新登录");
  const requestGeneration = generation;
  const controller = new AbortController();
  pending.add(controller);
  try {
    const response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      signal: init.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal,
    });
    if (response.status === 401) {
      if (requestGeneration === generation && !expired) {
        expired = true;
        // 先锁住后续轮询，再取消在途请求；App卸载工作台负责清理定时器和地图。
        for (const request of pending) request.abort();
        for (const listener of listeners) listener();
      }
      throw new Error("登录已失效，请重新登录");
    }
    return response;
  } finally {
    pending.delete(controller);
  }
}
