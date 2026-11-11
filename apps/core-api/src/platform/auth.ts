import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import {
  ForbiddenException,
  UnauthorizedException,
  HttpException,
} from "@nestjs/common";
import type { Principal, Repository, Role } from "./repository";
export interface Account {
  id: string;
  tenantId: string;
  role: Role;
  scenes: string[];
  passwordHash: string;
  disabled?: boolean;
}
/** 为新账号生成带随机盐的 scrypt 摘要；明文密码不会进入持久化数据。 */
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
/** 校验摘要格式并使用恒定时间比较，避免密码是否匹配影响比较耗时。 */
function verify(password: string, hash: string) {
  const [algorithm, salt, hex] = hash.split(":");
  if (algorithm !== "scrypt" || !salt || !/^[a-f0-9]{128}$/.test(hex ?? ""))
    return false;
  const actual = scryptSync(password, salt, 64),
    expected = Buffer.from(hex, "hex");
  return timingSafeEqual(actual, expected);
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class AuthService {
  private failures = new Map<string, { count: number; until: number }>();
  private dummyHash = hashPassword(randomUUID());
  constructor(
    private repo: Repository,
    private accounts: Account[],
    private allowDemo: boolean,
    private platformAdmins: readonly string[] = [],
  ) {}
  /** 校验账号、限制连续失败次数，并签发可撤销的服务端会话。 */
  async login(id: string, password: string, address: string) {
    if (
      typeof id !== "string" ||
      typeof password !== "string" ||
      id.length > 200 ||
      password.length > 1024
    )
      throw new UnauthorizedException("账号或密码错误");
    const key = `${address}\0${id}`,
      now = Date.now();
    const failure = this.failures.get(key);
    if (failure && failure.until > now && failure.count >= 5)
      throw new HttpException("登录尝试过多，请稍后重试", 429);
    const account = this.accounts.find((a) => a.id === id && !a.disabled);
    const valid = verify(password, account?.passwordHash ?? this.dummyHash);
    if (!account || !valid) {
      if (this.failures.size > 10000)
        for (const [k, v] of this.failures)
          if (v.until <= now) this.failures.delete(k);
      this.failures.set(key, {
        count: failure && failure.until > now ? failure.count + 1 : 1,
        until: now + 15 * 60000,
      });
      await this.repo.logAudit({
        tenantId: account?.tenantId ?? "system",
        actor: id,
        sceneId: "",
        action: "auth.login",
        result: "denied",
      });
      throw new UnauthorizedException("账号或密码错误");
    }
    this.failures.delete(key);
    const result = await this.issue(
      {
        id: account.id,
        tenantId: account.tenantId,
        role: account.role,
        scenes: account.scenes,
        kind: "account",
        platformAdmin:
          account.role === "admin" && this.platformAdmins.includes(account.id),
      },
      digest(account.passwordHash),
    );
    await this.repo.logAudit({
      tenantId: account.tenantId,
      actor: account.id,
      sceneId: "",
      action: "auth.login",
      result: "success",
    });
    return result;
  }
  /** 为演示访问创建独立租户，演示入口关闭后旧演示会话也会失效。 */
  async demo() {
    if (!this.allowDemo) throw new ForbiddenException("演示入口已关闭");
    const id = randomUUID();
    return this.issue({
      id: `demo-${id}`,
      tenantId: `demo-${id}`,
      role: "admin",
      scenes: ["xian", "taiyuan", "chengdu"],
      kind: "demo",
    });
  }
  /** 随机令牌只返回给浏览器；数据库仅保存令牌摘要和到期时间。 */
  private async issue(user: Principal, credentialVersion?: string) {
    const token = randomBytes(32).toString("hex");
    if (user.kind === "demo")
      await this.repo.saveConfiguration(
        user.tenantId,
        "demo-session-grant",
        0,
        { expiresAt: Date.now() + 8 * 3600000 },
        user.id,
        "auth.demo-grant",
      );
    await this.repo.putSession(digest(token), {
      user,
      credentialVersion,
      expiresAt: Date.now() + 8 * 3600000,
    });
    return { user, token };
  }
  /** 读取会话时重新核对账号状态与密码版本，确保停用或改密可即时撤销。 */
  async resolve(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.repo.getSession(digest(token));
    if (!session || session.expiresAt <= Date.now()) return null;
    if (session.user.kind === "demo")
      return this.allowDemo ? session.user : null;
    const account = this.accounts.find(
      (a) => a.id === session.user.id && !a.disabled,
    );
    if (!account || session.credentialVersion !== digest(account.passwordHash))
      return null;
    return {
      ...session.user,
      tenantId: account.tenantId,
      role: account.role,
      scenes: account.scenes,
      platformAdmin:
        account.role === "admin" && this.platformAdmins.includes(account.id),
    };
  }
  /** 删除服务端会话并记录退出审计，使令牌不能再次使用。 */
  async logout(token: string) {
    if (/^[a-f0-9]{64}$/.test(token)) {
      const hash = digest(token),
        session = await this.repo.getSession(hash);
      await this.repo.putSession(hash, null);
      if (session)
        await this.repo.logAudit({
          tenantId: session.user.tenantId,
          actor: session.user.id,
          sceneId: "",
          action: "auth.logout",
          result: "success",
        });
    }
  }
  /** 以服务端身份中的地区范围和角色执行授权，不采信客户端租户声明。 */
  async authorize(user: Principal, scene: string, write: boolean) {
    if (!user.scenes.includes(scene) || (write && user.role === "viewer")) {
      await this.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: scene,
        action: write ? "business.write" : "scene.read",
        result: "denied",
      });
      throw new ForbiddenException("无权访问该场景或操作");
    }
    return user;
  }
}
