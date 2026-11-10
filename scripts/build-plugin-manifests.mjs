import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const keyId = process.env.DTV_PLUGIN_KEY_ID || "build-root";
const suppliedPrivateKey = process.env.DTV_PLUGIN_SIGNING_KEY;
if (process.env.NODE_ENV === "production" && !suppliedPrivateKey)
  throw new Error("生产插件构建必须通过 DTV_PLUGIN_SIGNING_KEY 注入签名私钥");
const privateKey = suppliedPrivateKey
  ? createPrivateKey(suppliedPrivateKey)
  : generateKeyPairSync("ed25519").privateKey;
const publicKey = createPublicKey(privateKey).export({ format: "jwk" });
const trustRoots = { [keyId]: publicKey };
const source = JSON.parse(
  await readFile(resolve(root, "packages/plugins/catalog.json"), "utf8"),
);
if (
  source.version !== 1 ||
  !Array.isArray(source.plugins) ||
  source.plugins.length > 100
)
  throw new Error("插件源目录格式无效");
const ids = new Set();
const directories = new Set();
const manifests = [];
for (const plugin of source.plugins) {
  if (
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(plugin.id) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plugin.version) ||
    !Number.isInteger(plugin.coreApi) ||
    plugin.coreApi < 1 ||
    !/^[a-z0-9][a-z0-9-]*$/.test(plugin.directory)
  )
    throw new Error(`插件元数据无效：${plugin.id ?? "unknown"}`);
  if (ids.has(plugin.id) || directories.has(plugin.directory))
    throw new Error("插件 ID 或目录重复");
  ids.add(plugin.id);
  directories.add(plugin.directory);
  const entry = `/extensions/${plugin.directory}/index.js`;
  const bytes = await readFile(resolve(root, `apps/web/public${entry}`));
  const integrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
  const manifest = {
    id: plugin.id,
    version: plugin.version,
    coreApi: plugin.coreApi,
    entry,
    integrity,
    keyId,
  };
  const canonical = JSON.stringify(manifest);
  manifest.signature = sign(null, Buffer.from(canonical), privateKey).toString("base64");
  const directory = resolve(
    root,
    "apps/web/public/extensions",
    plugin.directory,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  manifests.push(`/extensions/${plugin.directory}/manifest.json`);
}
await writeFile(
  resolve(root, "apps/web/src/pluginTrustRoots.generated.ts"),
  `// 构建时由受信任公钥生成；此文件不包含签名私钥。\nexport const pluginTrustRoots: Record<string, JsonWebKey> = ${JSON.stringify(trustRoots, null, 2)};\n`,
);
await writeFile(
  resolve(root, "apps/web/public/extensions/catalog.json"),
  `${JSON.stringify({ version: 1, plugins: manifests }, null, 2)}\n`,
);
