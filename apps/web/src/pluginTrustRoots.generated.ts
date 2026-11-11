// 构建时由受信任公钥生成；此文件不包含签名私钥。
export const pluginTrustRoots: Record<string, JsonWebKey> = {
  "build-root": {
    "crv": "Ed25519",
    "x": "51SvO8d2NDoFDPv7EIwtqekcLaB_DHSQ3R0C8JXg7gQ",
    "kty": "OKP"
  }
};
