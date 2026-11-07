import { scryptSync, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const id = option("--id"),
  tenantId = option("--tenant"),
  role = option("--role") ?? "viewer",
  scenes = (option("--scenes") ?? "").split(",").filter(Boolean),
  output = option("--output");
if (
  !id ||
  !tenantId ||
  !output ||
  !["admin", "editor", "viewer"].includes(role) ||
  !scenes.length ||
  scenes.some((s) => !["xian", "taiyuan", "chengdu"].includes(s))
)
  throw new Error(
    "Usage: password via stdin | node scripts/create-account.mjs --id NAME --tenant TENANT --role admin|editor|viewer --scenes xian,taiyuan --output deploy/auth/users.json",
  );
let password = "";
for await (const chunk of process.stdin) {
  password += chunk.toString();
  if (password.length > 1026) throw new Error("密码过长");
}
password = password.replace(/[\r\n]+$/, "");
if (password.length < 12 || password.length > 1024)
  throw new Error("密码需12–1024字符");
const path = resolve(output);
let users = [];
try {
  users = JSON.parse(await readFile(path, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (!Array.isArray(users) || users.some((u) => u.id === id))
  throw new Error("账号已存在或配置格式错误；不会覆盖现有账号");
const salt = randomBytes(16).toString("hex"),
  passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
users.push({ id, tenantId, role, scenes, passwordHash });
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const temp = path + "." + randomBytes(8).toString("hex") + ".tmp";
await writeFile(temp, JSON.stringify(users, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
await rename(temp, path);
console.log("账号配置已保存（未输出密码或哈希）。重新启动 API 后生效。");
