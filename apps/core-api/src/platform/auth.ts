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
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
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
  ) {}
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
  private async issue(user: Principal, credentialVersion?: string) {
    const token = randomBytes(32).toString("hex");
    await this.repo.putSession(digest(token), {
      user,
      credentialVersion,
      expiresAt: Date.now() + 8 * 3600000,
    });
    return { user, token };
  }
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
    };
  }
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
