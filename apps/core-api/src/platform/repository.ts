import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { Pool } from "pg";
export type Role = "admin" | "editor" | "viewer";
export interface Principal {
  id: string;
  tenantId: string;
  role: Role;
  scenes: string[];
  kind: "account" | "demo";
}
export interface Session {
  user: Principal;
  expiresAt: number;
  credentialVersion?: string;
}
export interface Revision {
  revision: number;
  data: unknown;
}
export interface AuditEntry {
  id: string;
  tenantId: string;
  actor: string;
  sceneId: string;
  action: string;
  result: string;
  at: string;
}
export interface Repository {
  readBusiness(tenant: string, scene: string): Promise<Revision | null>;
  saveBusiness(
    tenant: string,
    scene: string,
    expected: number,
    data: unknown,
    actor: string,
  ): Promise<Revision>;
  getSession(hash: string): Promise<Session | null>;
  putSession(hash: string, session: Session | null): Promise<void>;
  audit(tenant: string): Promise<AuditEntry[]>;
  logAudit(entry: Omit<AuditEntry, "id" | "at">): Promise<void>;
}
interface DiskState {
  business: Record<string, Revision>;
  sessions: Record<string, Session>;
  audit: AuditEntry[];
}
const entry = (e: Omit<AuditEntry, "id" | "at">): AuditEntry => ({
  ...e,
  id: randomUUID(),
  at: new Date().toISOString(),
});
export class FileRepository implements Repository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private async read(): Promise<DiskState> {
    try {
      return JSON.parse(
        await readFile(join(this.directory, "platform.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { business: {}, sessions: {}, audit: [] };
      throw e;
    }
  }
  private async mutate<T>(fn: (state: DiskState) => T): Promise<T> {
    const task = this.queue.then(async () => {
      const state = await this.read(),
        result = fn(state);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = join(this.directory, `${randomUUID()}.tmp`);
      await writeFile(path, JSON.stringify(state), { mode: 0o600 });
      await rename(path, join(this.directory, "platform.json"));
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private key(tenant: string, scene: string) {
    return JSON.stringify([tenant, scene]);
  }
  async readBusiness(tenant: string, scene: string) {
    await this.queue;
    return (await this.read()).business[this.key(tenant, scene)] ?? null;
  }
  async saveBusiness(
    tenant: string,
    scene: string,
    expected: number,
    data: unknown,
    actor: string,
  ) {
    return this.mutate((state) => {
      const key = this.key(tenant, scene);
      if ((state.business[key]?.revision ?? 0) !== expected)
        throw new ConflictException("资料修订冲突，请重新加载后再修改");
      const value = { revision: expected + 1, data };
      state.business[key] = value;
      state.audit.push(
        entry({
          tenantId: tenant,
          actor,
          sceneId: scene,
          action: "business.write",
          result: "success",
        }),
      );
      return value;
    });
  }
  async getSession(hash: string) {
    await this.queue;
    return (await this.read()).sessions[hash] ?? null;
  }
  async putSession(hash: string, session: Session | null) {
    await this.mutate((s) => {
      for (const [id, value] of Object.entries(s.sessions))
        if (value.expiresAt < Date.now()) delete s.sessions[id];
      if (session) s.sessions[hash] = session;
      else delete s.sessions[hash];
    });
  }
  async audit(tenant: string) {
    await this.queue;
    return (await this.read()).audit
      .filter((e) => e.tenantId === tenant)
      .slice(-500);
  }
  async logAudit(e: Omit<AuditEntry, "id" | "at">) {
    await this.mutate((s) => {
      s.audit.push(entry(e));
    });
  }
}
export class PostgresRepository implements Repository {
  constructor(readonly pool: Pool) {}
  async readBusiness(tenant: string, scene: string) {
    const r = await this.pool.query(
      "SELECT revision,data FROM scene_business WHERE tenant_id=$1 AND scene_id=$2",
      [tenant, scene],
    );
    return r.rows[0]
      ? { revision: Number(r.rows[0].revision), data: r.rows[0].data }
      : null;
  }
  async saveBusiness(
    tenant: string,
    scene: string,
    expected: number,
    data: unknown,
    actor: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r =
        expected === 0
          ? await client.query(
              "INSERT INTO scene_business(tenant_id,scene_id,revision,data) VALUES($1,$2,1,$3::jsonb) ON CONFLICT(tenant_id,scene_id) DO NOTHING RETURNING revision,data",
              [tenant, scene, JSON.stringify(data)],
            )
          : await client.query(
              "UPDATE scene_business SET revision=revision+1,data=$4::jsonb,updated_at=now() WHERE tenant_id=$1 AND scene_id=$2 AND revision=$3 RETURNING revision,data",
              [tenant, scene, expected, JSON.stringify(data)],
            );
      if (!r.rowCount)
        throw new ConflictException("资料修订冲突，请重新加载后再修改");
      await client.query(
        "INSERT INTO platform_audit(id,tenant_id,actor,scene_id,action,result) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), tenant, actor, scene, "business.write", "success"],
      );
      await client.query("COMMIT");
      return { revision: Number(r.rows[0].revision), data: r.rows[0].data };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async getSession(hash: string) {
    const r = await this.pool.query(
      "SELECT data FROM platform_session WHERE token_hash=$1 AND expires_at>now()",
      [hash],
    );
    return r.rows[0]?.data ?? null;
  }
  async putSession(hash: string, session: Session | null) {
    if (session)
      await this.pool.query(
        "INSERT INTO platform_session(token_hash,data,expires_at) VALUES($1,$2,$3) ON CONFLICT(token_hash) DO UPDATE SET data=EXCLUDED.data,expires_at=EXCLUDED.expires_at",
        [hash, JSON.stringify(session), new Date(session.expiresAt)],
      );
    else
      await this.pool.query(
        "DELETE FROM platform_session WHERE token_hash=$1",
        [hash],
      );
  }
  async audit(tenant: string) {
    const r = await this.pool.query(
      'SELECT id,tenant_id AS "tenantId",actor,scene_id AS "sceneId",action,result,created_at AS at FROM platform_audit WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 500',
      [tenant],
    );
    return r.rows;
  }
  async logAudit(e: Omit<AuditEntry, "id" | "at">) {
    await this.pool.query(
      "INSERT INTO platform_audit(id,tenant_id,actor,scene_id,action,result) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), e.tenantId, e.actor, e.sceneId, e.action, e.result],
    );
  }
}
