export interface PluginManifest {
  id: string;
  version: string;
  coreApi: number;
  entry: string;
  integrity: string;
  keyId: string;
  signature: string;
}

const manifestPath = /^\/extensions\/[a-zA-Z0-9._/-]+\/manifest\.json$/;
const entryPath = /^\/extensions\/[a-zA-Z0-9._/-]+\.js$/;
const idPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const integrityPattern = /^sha256-[A-Za-z0-9+/]{43}=$/;

function validLocalPath(value: unknown, pattern: RegExp) {
  if (typeof value !== "string" || !pattern.test(value)) return false;
  return value.split("/").every((part) => part !== "." && part !== "..");
}

export function parsePluginCatalog(value: unknown): string[] {
  if (!value || typeof value !== "object") throw new Error("插件目录格式无效");
  const catalog = value as { version?: unknown; plugins?: unknown };
  if (
    catalog.version !== 1 ||
    !Array.isArray(catalog.plugins) ||
    catalog.plugins.length > 100
  )
    throw new Error("插件目录格式无效");
  const paths = catalog.plugins;
  if (!paths.every((path) => validLocalPath(path, manifestPath)))
    throw new Error("同源插件清单路径无效");
  if (new Set(paths).size !== paths.length) throw new Error("插件清单路径重复");
  return paths as string[];
}

export function parsePluginManifest(
  value: unknown,
  supportedCoreApi: number,
): PluginManifest {
  if (!value || typeof value !== "object") throw new Error("插件清单格式无效");
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.id !== "string" ||
    !idPattern.test(manifest.id) ||
    typeof manifest.version !== "string" ||
    !versionPattern.test(manifest.version) ||
    !Number.isInteger(manifest.coreApi) ||
    Number(manifest.coreApi) < 1 ||
    typeof manifest.integrity !== "string" ||
    !integrityPattern.test(manifest.integrity) ||
    typeof manifest.keyId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(manifest.keyId) ||
    typeof manifest.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature)
  )
    throw new Error("插件清单格式无效");
  if (!validLocalPath(manifest.entry, entryPath))
    throw new Error("插件入口必须在同源扩展目录内");
  if (manifest.coreApi !== supportedCoreApi) throw new Error("SDK 版本不兼容");
  return {
    id: manifest.id,
    version: manifest.version,
    coreApi: Number(manifest.coreApi),
    entry: manifest.entry as string,
    integrity: manifest.integrity,
    keyId: manifest.keyId,
    signature: manifest.signature,
  };
}

/** Ed25519 验签只信任由宿主构建时注入的公钥；清单签名覆盖所有身份和入口字段。 */
export async function verifyPluginSignature(
  manifest: PluginManifest,
  trustRoots: Record<string, JsonWebKey>,
): Promise<boolean> {
  const jwk = trustRoots[manifest.keyId];
  if (!jwk) return false;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "jwk", jwk, { name: "Ed25519" }, false, ["verify"],
    );
    const canonical = JSON.stringify({
      id: manifest.id, version: manifest.version, coreApi: manifest.coreApi,
      entry: manifest.entry, integrity: manifest.integrity, keyId: manifest.keyId,
    });
    const signature = Uint8Array.from(atob(manifest.signature), (c) => c.charCodeAt(0));
    return globalThis.crypto.subtle.verify(
      { name: "Ed25519" }, key, signature, new TextEncoder().encode(canonical),
    );
  } catch {
    return false;
  }
}

export async function verifyPluginIntegrity(
  manifest: PluginManifest,
  source: string,
): Promise<boolean> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}` === manifest.integrity;
}
