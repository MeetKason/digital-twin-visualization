import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  parsePluginCatalog,
  parsePluginManifest,
  verifyPluginIntegrity,
  verifyPluginSignature,
} from "../packages/sdk/src/pluginManifest";

const source = `export default {manifest:{id:"test.plugin",version:"1.2.3",coreApi:1},activate:async()=>()=>{}}`;
const integrity = `sha256-${createHash("sha256").update(source).digest("base64")}`;
const valid = {
  id: "test.plugin",
  version: "1.2.3",
  coreApi: 1,
  entry: "/extensions/test/plugin.js",
  integrity,
  keyId: "dev-root",
  signature: "A".repeat(86) + "==",
};

it("accepts a same-origin catalog and rejects remote or duplicate manifest paths", () => {
  expect(
    parsePluginCatalog({
      version: 1,
      plugins: ["/extensions/test/manifest.json"],
    }),
  ).toEqual(["/extensions/test/manifest.json"]);
  expect(() =>
    parsePluginCatalog({
      version: 1,
      plugins: ["https://example.invalid/plugin.json"],
    }),
  ).toThrow("同源插件清单路径无效");
  expect(() =>
    parsePluginCatalog({
      version: 1,
      plugins: [
        "/extensions/test/manifest.json",
        "/extensions/test/manifest.json",
      ],
    }),
  ).toThrow("插件清单路径重复");
});

it("validates manifest identity, entry path, SDK compatibility and integrity", async () => {
  expect(parsePluginManifest(valid, 1)).toMatchObject({
    id: "test.plugin",
    version: "1.2.3",
  });
  expect(() =>
    parsePluginManifest(
      { ...valid, entry: "https://bad.invalid/plugin.js" },
      1,
    ),
  ).toThrow("插件入口必须在同源扩展目录内");
  expect(() =>
    parsePluginManifest({ ...valid, entry: "/extensions/../private.js" }, 1),
  ).toThrow("插件入口必须在同源扩展目录内");
  expect(() => parsePluginManifest({ ...valid, coreApi: 2 }, 1)).toThrow(
    "SDK 版本不兼容",
  );
  const manifest = parsePluginManifest(valid, 1);
  expect(await verifyPluginIntegrity(manifest, source)).toBe(true);
  expect(await verifyPluginIntegrity(manifest, `${source}// changed`)).toBe(
    false,
  );
});

it("requires a trusted Ed25519 signature for the canonical plugin manifest", async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const unsigned = { ...valid, keyId: "test-root", signature: "" };
  const canonical = JSON.stringify({ id: unsigned.id, version: unsigned.version,
    coreApi: unsigned.coreApi, entry: unsigned.entry, integrity: unsigned.integrity,
    keyId: unsigned.keyId });
  unsigned.signature = sign(null, Buffer.from(canonical), privateKey).toString("base64");
  const manifest = parsePluginManifest(unsigned, 1);
  expect(await verifyPluginSignature(manifest, { "test-root": publicJwk })).toBe(true);
  expect(await verifyPluginSignature({ ...manifest, version: "9.9.9" }, { "test-root": publicJwk })).toBe(false);
  expect(await verifyPluginSignature(manifest, {})).toBe(false);
});
