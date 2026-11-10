// 构建时由受信任公钥生成；此文件不包含签名私钥。
export const pluginTrustRoots: Record<string, JsonWebKey> = {
  "build-root": {
    "crv": "Ed25519",
    "x": "B_XE3FQVj0ZyiMrJgkYsYsoEOIfa_eO4OnUQT6-qyCU",
    "kty": "OKP"
  }
};
