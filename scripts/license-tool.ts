/** 离线授权发行工具：私钥只读本机受限文件，绝不输出密钥或写入仓库。 */
import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import {
  LicensePayloadSchema,
  licenseCanonical,
} from "../packages/contracts/src/licensing";
const args = process.argv.slice(2),
  command = args[0];
function option(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
try {
  const keyId = option("--key-id") ?? "issuer";
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(keyId)) throw Error("签名根ID无效");
  if (command === "init") {
    const directory = option("--directory");
    if (!directory) throw Error("请指定仓库外的--directory");
    const root = resolve(directory),
      project = resolve(import.meta.dirname, ".."),
      path = relative(project, root);
    if (!(path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)))
      throw Error("签发私钥目录必须在项目仓库之外");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const actual = relative(await realpath(project), await realpath(root));
    if (
      !(actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual))
    )
      throw Error("签发私钥目录不能通过符号链接指向仓库内部");
    const pair = generateKeyPairSync("ed25519");
    await writeFile(
      resolve(root, "issuer-private.pem"),
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(
      resolve(root, "trust-roots.json"),
      JSON.stringify(
        { [keyId]: pair.publicKey.export({ format: "jwk" }) },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    console.log("签发密钥与公钥文件已创建；仅将trust-roots.json交给服务器。");
  } else if (command === "sign") {
    const payloadPath = option("--payload"),
      privatePath = option("--private-key"),
      output = option("--output");
    if (!payloadPath || !privatePath || !output)
      throw Error("需提供--payload、--private-key和--output");
    const payload = LicensePayloadSchema.parse(
        JSON.parse(await readFile(payloadPath, "utf8")),
      ),
      key = createPrivateKey(await readFile(privatePath, "utf8"));
    if (key.asymmetricKeyType !== "ed25519") throw Error("仅支持Ed25519私钥");
    const signature = sign(
      null,
      Buffer.from(licenseCanonical(keyId, payload)),
      key,
    ).toString("base64");
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(
      output,
      JSON.stringify({ keyId, payload, signature }, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    console.log("签名许可证已生成，未输出私钥。");
  } else
    throw Error(
      "用法：node --import tsx scripts/license-tool.ts init|sign [参数]",
    );
} catch (error) {
  console.error(
    error instanceof Error && error.name !== "ZodError"
      ? error.message
      : "授权数据格式校验失败",
  );
  process.exitCode = 1;
}
