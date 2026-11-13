/** 兼容 HTTP 演示地址和旧浏览器生成 UUID；业务 ID 不承载授权或认证能力。 */
function randomUuid(): string | null {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") return null;

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

/** 生成唯一业务标识；HTTPS 用 randomUUID，HTTP 用 Web Crypto 的随机字节。 */
export function createId(): string {
  return randomUuid() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** 插件隔离通道的 nonce 必须使用密码学安全随机数，禁止降级到 Math.random。 */
export function createSecureId(): string {
  const value = randomUuid();
  if (!value) throw new Error("当前浏览器无法生成安全随机标识，请使用现代浏览器");
  return value;
}
