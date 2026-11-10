import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import type { BusinessData, BusinessPublication } from "@dtv/contracts";
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
  publishBusiness(
    tenant: string,
    scene: string,
    revision: number,
    actor: string,
    message: string,
  ): Promise<BusinessPublication>;
  rollbackBusiness(
    tenant: string,
    scene: string,
    targetRevision: number,
    expectedRevision: number,
    actor: string,
  ): Promise<Revision>;
  reviewPublication(
    tenant: string, scene: string, revision: number, reviewer: string,
    decision: "approve" | "reject", message: string,
  ): Promise<BusinessPublication>;
  activatePublication(
    tenant: string, scene: string, revision: number, actor: string, trafficPercent?: number,
  ): Promise<BusinessPublication>;
  activePublication(tenant: string, scene: string): Promise<BusinessPublication | null>;
  publications(tenant: string, scene: string): Promise<BusinessPublication[]>;
}
interface DiskState {
  business: Record<string, StoredRevision>;
  sessions: Record<string, Session>;
  audit: AuditEntry[];
  publications?: BusinessPublication[];
  activePublications?: Record<string, { revision: number; trafficPercent: number; previousRevision?: number }>;
}
interface StoredRevision extends Revision {
  /** 指向不可变实体 bundle；旧版 platform.json 尚无此字段。 */
  bundleId?: string;
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
      const parsed = JSON.parse(
        await readFile(join(this.directory, "platform.json"), "utf8"),
      );
      const business: DiskState["business"] = {};
      for (const [key, pointer] of Object.entries(
        (parsed.business ?? {}) as Record<string, StoredRevision>,
      )) {
        if (!pointer.bundleId) {
          business[key] = pointer;
          continue;
        }
        const bundle = join(
          this.directory,
          "business-bundles",
          createHash("sha256").update(key).digest("hex"),
          pointer.bundleId,
        );
        const readArray = async (name: string) =>
          JSON.parse(await readFile(join(bundle, `${name}.json`), "utf8"));
        const metadata = JSON.parse(
          await readFile(join(bundle, "metadata.json"), "utf8"),
        );
        const data = { ...metadata.values } as Record<string, unknown>;
        const entityFields = new Set<string>(metadata.entityFields ?? []);
        for (const name of ["stations", "assets", "bookmarks", "plans"])
          if (entityFields.has(name)) data[name] = await readArray(name);
        business[key] = {
          revision: pointer.revision,
          bundleId: pointer.bundleId,
          data,
        };
      }
      return {
        ...parsed,
        sessions: parsed.sessions ?? {},
        audit: parsed.audit ?? [],
        business,
        publications: parsed.publications ?? [],
        activePublications: parsed.activePublications ?? {},
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { business: {}, sessions: {}, audit: [], activePublications: {} };
      throw e;
    }
  }
  /** 文件仓库仅供单进程开发使用；队列串行修改并以原子指针保存业务修订。 */
  private async mutate<T>(fn: (state: DiskState) => T): Promise<T> {
    const task = this.queue.then(async () => {
      const state = await this.read(),
        result = fn(state);
      await this.writeState(state);
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  /** bundle 先完整落盘，最后原子替换 platform.json 指针完成提交。 */
  private async writeState(state: DiskState) {
    const pointers: Record<string, { revision: number; bundleId: string }> = {};
    for (const [key, revision] of Object.entries(state.business)) {
      const bundleId = revision.bundleId ?? `r${revision.revision}-${randomUUID()}`;
      const scope = createHash("sha256").update(key).digest("hex");
      const parent = join(this.directory, "business-bundles", scope);
      const target = join(parent, bundleId);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      // 已存在的 bundle 不可改写；同一 CAS 修订会继续复用它。
      try {
        await readFile(join(target, "metadata.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const temporary = join(parent, `.${bundleId}.${randomUUID()}.tmp`);
        await mkdir(temporary, { mode: 0o700 });
        try {
          const data = revision.data as Record<string, unknown>;
          const write = (name: string, value: unknown) =>
            writeFile(join(temporary, `${name}.json`), JSON.stringify(value), { mode: 0o600 });
          const entityNames = ["stations", "assets", "bookmarks", "plans"];
          const entityFields = entityNames.filter((name) => Object.hasOwn(data, name));
          const values = Object.fromEntries(
            Object.entries(data).filter(([name]) => !entityNames.includes(name)),
          );
          await write("metadata", { values, entityFields });
          for (const name of entityNames)
            await write(name, Array.isArray(data[name]) ? data[name] : []);
          await rename(temporary, target);
        } catch (error) {
          await import("node:fs/promises").then(({ rm }) =>
            rm(temporary, { recursive: true, force: true }),
          );
          throw error;
        }
      }
      pointers[key] = { revision: revision.revision, bundleId };
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stored = { ...state, business: pointers };
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(stored), { mode: 0o600 });
    await rename(temporary, join(this.directory, "platform.json"));
  }
  private key(tenant: string, scene: string) {
    return JSON.stringify([tenant, scene]);
  }
  async readBusiness(tenant: string, scene: string) {
    await this.queue;
    const key = this.key(tenant, scene);
    let current = (await this.read()).business[key];
    if (current && !current.bundleId) {
      // 旧格式在首次业务读取时转换；原数据文件不删除，确保可人工恢复。
      await this.mutate(() => undefined);
      current = (await this.read()).business[key];
    }
    return current ? { revision: current.revision, data: current.data } : null;
  }
  /** 使用期望修订号做 CAS，避免并发保存覆盖其他用户的新版本。 */
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
  async publishBusiness(
    tenant: string,
    scene: string,
    revision: number,
    actor: string,
    message: string,
  ) {
    return this.mutate((state) => {
      const current = state.business[this.key(tenant, scene)];
      if (!current || current.revision !== revision)
        throw new ConflictException("发布修订已变化，请重新加载");
      state.publications ??= [];
      if (
        state.publications.some(
          (item) =>
            item.tenantId === tenant &&
            item.sceneId === scene &&
            item.revision === revision,
        )
      )
        throw new ConflictException("此修订已经发布");
      const publication: BusinessPublication = {
        id: randomUUID(),
        tenantId: tenant,
        sceneId: scene,
        revision,
        publisher: actor,
        message,
        publishedAt: new Date().toISOString(),
        snapshot: structuredClone(current.data) as BusinessData,
        approvalStatus: "pending_approval",
      };
      state.publications.push(publication);
      state.audit.push(
        entry({
          tenantId: tenant,
          actor,
          sceneId: scene,
          action: "business.publish",
          result: "success",
        }),
      );
      return publication;
    });
  }
  async publications(tenant: string, scene: string) {
    await this.queue;
    const state = await this.read();
    const active = state.activePublications?.[this.key(tenant, scene)];
    return ((state.publications ?? [])
      .filter((item) => item.tenantId === tenant && item.sceneId === scene)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 100)).map((item) => ({
        ...item,
        approvalStatus: item.approvalStatus ?? "pending_approval",
        active: item.revision === active?.revision,
        ...(item.revision === active?.revision ? { trafficPercent: active.trafficPercent } : {}),
      }));
  }
  async activePublication(tenant: string, scene: string) {
    await this.queue;
    const state = await this.read();
    const active = state.activePublications?.[this.key(tenant, scene)];
    if (active === undefined) return null;
    const item = (state.publications ?? []).find((publication) =>
      publication.tenantId === tenant && publication.sceneId === scene &&
      publication.revision === active.revision,
    );
    return item ? { ...item, active: true, trafficPercent: active.trafficPercent,
      ...(active.previousRevision === undefined ? {} : { previousRevision: active.previousRevision }) } : null;
  }
  async reviewPublication(
    tenant: string,
    scene: string,
    revision: number,
    reviewer: string,
    decision: "approve" | "reject",
    message: string,
  ) {
    return this.mutate((state) => {
      const item = (state.publications ?? []).find((publication) =>
        publication.tenantId === tenant && publication.sceneId === scene &&
        publication.revision === revision,
      );
      if (!item) throw new ConflictException("发布版本不存在");
      if ((item.approvalStatus ?? "pending_approval") !== "pending_approval")
        throw new ConflictException("发布版本已处理，不能重复审批");
      if (item.publisher === reviewer)
        throw new ConflictException("发布者不能审批自己的版本");
      item.approvalStatus = decision === "approve" ? "approved" : "rejected";
      item.reviewedAt = new Date().toISOString();
      item.reviewMessage = message;
      if (decision === "approve") item.approvedBy = reviewer;
      else item.rejectedBy = reviewer;
      state.audit.push(entry({
        tenantId: tenant, actor: reviewer, sceneId: scene,
        action: decision === "approve" ? "business.publish.approve" : "business.publish.reject",
        result: "success",
      }));
      const active = state.activePublications?.[this.key(tenant, scene)];
      return { ...item, active: item.revision === active?.revision,
        ...(item.revision === active?.revision ? { trafficPercent: active.trafficPercent } : {}) };
    });
  }
  async activatePublication(tenant: string, scene: string, revision: number, actor: string, trafficPercent = 100) {
    return this.mutate((state) => {
      const item = (state.publications ?? []).find((publication) =>
        publication.tenantId === tenant && publication.sceneId === scene &&
        publication.revision === revision,
      );
      if (!item) throw new ConflictException("发布版本不存在");
      if (item.approvalStatus !== "approved")
        throw new ConflictException("发布版本尚未审批通过");
      state.activePublications ??= {};
      if (!Number.isInteger(trafficPercent) || trafficPercent < 1 || trafficPercent > 100)
        throw new ConflictException("灰度比例必须是 1 到 100 的整数");
      const scope = this.key(tenant, scene);
      const previousRevision = state.activePublications[scope]?.revision;
      if (previousRevision === revision) throw new ConflictException("该版本已是当前活动版本");
      state.activePublications[scope] = {
        revision, trafficPercent,
        ...(previousRevision === undefined ? {} : { previousRevision }),
      };
      state.audit.push(entry({
        tenantId: tenant, actor, sceneId: scene,
        action: "business.publish.activate", result: "success",
      }));
      return { ...item, active: true, trafficPercent,
        ...(previousRevision === undefined ? {} : { previousRevision }) };
    });
  }
  async rollbackBusiness(
    tenant: string,
    scene: string,
    targetRevision: number,
    expectedRevision: number,
    actor: string,
  ) {
    return this.mutate((state) => {
      const key = this.key(tenant, scene);
      const current = state.business[key];
      if (!current || current.revision !== expectedRevision)
        throw new ConflictException("资料修订冲突，请重新加载后再回滚");
      const publication = (state.publications ?? []).find((item) =>
        item.tenantId === tenant && item.sceneId === scene &&
        item.revision === targetRevision,
      );
      if (!publication) throw new ConflictException("发布版本不存在");
      const restored = { revision: current.revision + 1, data: structuredClone(publication.snapshot) };
      state.business[key] = restored;
      state.audit.push(entry({
        tenantId: tenant,
        actor,
        sceneId: scene,
        action: "business.rollback",
        result: "success",
      }));
      return restored;
    });
  }
}
export class PostgresRepository implements Repository {
  constructor(readonly pool: Pool) {}
  /** 将业务集合关系化写入实体表，与 JSONB 修订在同一事务内保持一致。 */
  private async syncBusinessEntities(
    client: PoolClient,
    tenant: string,
    scene: string,
    data: unknown,
  ) {
    const json = JSON.stringify(data);
    await client.query(
      "DELETE FROM scene_cruise_point WHERE tenant_id=$1 AND scene_id=$2",
      [tenant, scene],
    );
    await client.query(
      "DELETE FROM scene_cruise_plan WHERE tenant_id=$1 AND scene_id=$2",
      [tenant, scene],
    );
    await client.query(
      "DELETE FROM scene_bookmark WHERE tenant_id=$1 AND scene_id=$2",
      [tenant, scene],
    );
    await client.query(
      "DELETE FROM scene_asset WHERE tenant_id=$1 AND scene_id=$2",
      [tenant, scene],
    );
    await client.query(
      "DELETE FROM scene_station WHERE tenant_id=$1 AND scene_id=$2",
      [tenant, scene],
    );
    await client.query(
      `INSERT INTO scene_station(tenant_id,scene_id,station_id,name,station_type,longitude,latitude,elevation_m,data)
      SELECT $1,$2,item->>'id',item->>'name',COALESCE(item->>'type',''),(item->>'lon')::double precision,(item->>'lat')::double precision,COALESCE((item->>'elevationM')::double precision,0),item
      FROM jsonb_array_elements(COALESCE($3::jsonb->'stations','[]'::jsonb)) item`,
      [tenant, scene, json],
    );
    await client.query(
      `INSERT INTO scene_asset(tenant_id,scene_id,asset_id,name,kind,blob_id,file_name,size_bytes,station_id,data)
      SELECT $1,$2,item->>'id',item->>'name',item->>'kind',item->>'blobId',item->>'fileName',(item->>'size')::bigint,item->>'stationId',item
      FROM jsonb_array_elements(COALESCE($3::jsonb->'assets','[]'::jsonb)) item`,
      [tenant, scene, json],
    );
    await client.query(
      `INSERT INTO scene_bookmark(tenant_id,scene_id,bookmark_id,name,view,data)
      SELECT $1,$2,item->>'id',item->>'name',item->'view',item
      FROM jsonb_array_elements(COALESCE($3::jsonb->'bookmarks','[]'::jsonb)) item`,
      [tenant, scene, json],
    );
    await client.query(
      `INSERT INTO scene_cruise_plan(tenant_id,scene_id,plan_id,name,saved,data)
      SELECT $1,$2,item->>'id',item->>'name',COALESCE((item->>'saved')::boolean,false),item
      FROM jsonb_array_elements(COALESCE($3::jsonb->'plans','[]'::jsonb)) item`,
      [tenant, scene, json],
    );
    await client.query(
      `INSERT INTO scene_cruise_point(tenant_id,scene_id,plan_id,point_id,ordinal,name,longitude,latitude,height_m,model_id,bookmark_id,data)
      SELECT $1,$2,plan.value->>'id',point.value->>'id',point.ordinality::integer,point.value->>'name',(point.value->>'lon')::double precision,(point.value->>'lat')::double precision,(point.value->>'height')::double precision,point.value->>'modelId',point.value->>'bookmarkId',point.value
      FROM jsonb_array_elements(COALESCE($3::jsonb->'plans','[]'::jsonb)) AS plan(value)
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(plan.value->'points','[]'::jsonb)) WITH ORDINALITY AS point(value,ordinality)`,
      [tenant, scene, json],
    );
  }
  /** 关系表是业务实体读路径；旧修订由迁移/兼容读取处理。 */
  async readBusiness(tenant: string, scene: string) {
    // 业务读路径以关系实体为准；JSONB 只暂存版本元数据和尚未关系化的用户列表。
    // 单条 SQL 保证所有实体集合与修订号来自同一条 PostgreSQL 语句快照。
    const r = await this.pool.query(
      `SELECT b.revision,
        jsonb_build_object(
          'version', COALESCE(b.data->'version', '1'::jsonb),
          'users', COALESCE(b.data->'users', '[]'::jsonb),
          'stations', COALESCE((SELECT jsonb_agg(e.data ORDER BY e.station_id)
            FROM scene_station e WHERE e.tenant_id=b.tenant_id AND e.scene_id=b.scene_id), '[]'::jsonb),
          'assets', COALESCE((SELECT jsonb_agg(e.data ORDER BY e.asset_id)
            FROM scene_asset e WHERE e.tenant_id=b.tenant_id AND e.scene_id=b.scene_id), '[]'::jsonb),
          'bookmarks', COALESCE((SELECT jsonb_agg(e.data ORDER BY e.bookmark_id)
            FROM scene_bookmark e WHERE e.tenant_id=b.tenant_id AND e.scene_id=b.scene_id), '[]'::jsonb),
          'plans', COALESCE((SELECT jsonb_agg(
            p.data || jsonb_build_object('points', COALESCE((
              SELECT jsonb_agg(point.data ORDER BY point.ordinal)
              FROM scene_cruise_point point
              WHERE point.tenant_id=p.tenant_id AND point.scene_id=p.scene_id
                AND point.plan_id=p.plan_id
            ), '[]'::jsonb)) ORDER BY p.plan_id)
            FROM scene_cruise_plan p WHERE p.tenant_id=b.tenant_id AND p.scene_id=b.scene_id), '[]'::jsonb)
        ) AS data
       FROM scene_business b WHERE b.tenant_id=$1 AND b.scene_id=$2`,
      [tenant, scene],
    );
    return r.rows[0]
      ? { revision: Number(r.rows[0].revision), data: r.rows[0].data }
      : null;
  }
  /** 事务中核对修订号、写 JSONB 修订并同步实体表，冲突时整体回滚。 */
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
      await this.syncBusinessEntities(client, tenant, scene, r.rows[0].data);
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
  async publishBusiness(
    tenant: string,
    scene: string,
    revision: number,
    actor: string,
    message: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ revision: number; data: unknown }>(
        "SELECT revision,data FROM scene_business WHERE tenant_id=$1 AND scene_id=$2 FOR UPDATE",
        [tenant, scene],
      );
      if (!current.rowCount || Number(current.rows[0].revision) !== revision)
        throw new ConflictException("发布修订已变化，请重新加载");
      const id = randomUUID();
      const result = await client.query<{ published_at: Date }>(
        `INSERT INTO scene_publication(id,tenant_id,scene_id,revision,publisher,message,snapshot)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT(tenant_id,scene_id,revision) DO NOTHING RETURNING published_at`,
        [
          id,
          tenant,
          scene,
          revision,
          actor,
          message,
          JSON.stringify(current.rows[0].data),
        ],
      );
      if (!result.rowCount) throw new ConflictException("此修订已经发布");
      await client.query(
        "INSERT INTO platform_audit(id,tenant_id,actor,scene_id,action,result) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), tenant, actor, scene, "business.publish", "success"],
      );
      await client.query("COMMIT");
      return {
        id,
        tenantId: tenant,
        sceneId: scene,
        revision,
        publisher: actor,
        message,
        publishedAt: result.rows[0].published_at.toISOString(),
        snapshot: current.rows[0].data as BusinessData,
        approvalStatus: "pending_approval" as const,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async publications(
    tenant: string,
    scene: string,
  ): Promise<BusinessPublication[]> {
    const result = await this.pool.query<BusinessPublication>(
      `SELECT p.id,p.tenant_id AS "tenantId",p.scene_id AS "sceneId",p.revision,p.publisher,p.message,
        p.published_at AS "publishedAt",p.snapshot,p.approval_status AS "approvalStatus",
        p.approved_by AS "approvedBy",p.rejected_by AS "rejectedBy",p.reviewed_at AS "reviewedAt",
        p.review_message AS "reviewMessage",(active.revision IS NOT NULL) AS active,
        CASE WHEN active.revision IS NOT NULL THEN active.traffic_percent END AS "trafficPercent",
        CASE WHEN active.revision IS NOT NULL THEN active.previous_revision END AS "previousRevision"
       FROM scene_publication p LEFT JOIN scene_active_publication active
         ON active.tenant_id=p.tenant_id AND active.scene_id=p.scene_id AND active.revision=p.revision
       WHERE p.tenant_id=$1 AND p.scene_id=$2 ORDER BY p.published_at DESC LIMIT 100`,
      [tenant, scene],
    );
    return result.rows.map((row) => ({ ...row,
      publishedAt: String(row.publishedAt),
      reviewedAt: row.reviewedAt ? String(row.reviewedAt) : undefined,
    }));
  }
  async activePublication(tenant: string, scene: string) {
    const result = await this.pool.query<BusinessPublication>(
      `SELECT p.id,p.tenant_id AS "tenantId",p.scene_id AS "sceneId",p.revision,
        p.publisher,p.message,p.published_at AS "publishedAt",p.snapshot,
        p.approval_status AS "approvalStatus",p.approved_by AS "approvedBy",
        p.rejected_by AS "rejectedBy",p.reviewed_at AS "reviewedAt",
        p.review_message AS "reviewMessage",true AS active,active.traffic_percent AS "trafficPercent",
        active.previous_revision AS "previousRevision"
       FROM scene_active_publication active JOIN scene_publication p
        ON p.tenant_id=active.tenant_id AND p.scene_id=active.scene_id AND p.revision=active.revision
       WHERE active.tenant_id=$1 AND active.scene_id=$2`,
      [tenant, scene],
    );
    const row = result.rows[0];
    return row ? { ...row, publishedAt: String(row.publishedAt), reviewedAt: row.reviewedAt ? String(row.reviewedAt) : undefined } : null;
  }
  /** 只允许非发布者对待审批快照作一次决定，并记录审批人和意见。 */
  async reviewPublication(
    tenant: string, scene: string, revision: number, reviewer: string,
    decision: "approve" | "reject", message: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ publisher: string; approval_status: string }>(
        "SELECT publisher,approval_status FROM scene_publication WHERE tenant_id=$1 AND scene_id=$2 AND revision=$3 FOR UPDATE",
        [tenant, scene, revision],
      );
      if (!current.rowCount) throw new ConflictException("发布版本不存在");
      if (current.rows[0].approval_status !== "pending_approval")
        throw new ConflictException("发布版本已处理，不能重复审批");
      if (current.rows[0].publisher === reviewer)
        throw new ConflictException("发布者不能审批自己的版本");
      const status = decision === "approve" ? "approved" : "rejected";
      const result = await client.query<BusinessPublication>(
        `UPDATE scene_publication SET approval_status=$4,
          approved_by=CASE WHEN $4='approved' THEN $5 ELSE NULL END,
          rejected_by=CASE WHEN $4='rejected' THEN $5 ELSE NULL END,
          reviewed_at=now(),review_message=$6
         WHERE tenant_id=$1 AND scene_id=$2 AND revision=$3
         RETURNING id,tenant_id AS "tenantId",scene_id AS "sceneId",revision,publisher,
          message,published_at AS "publishedAt",snapshot,approval_status AS "approvalStatus",
          approved_by AS "approvedBy",rejected_by AS "rejectedBy",reviewed_at AS "reviewedAt",
          review_message AS "reviewMessage"`,
        [tenant, scene, revision, status, reviewer, message],
      );
      await client.query(
        "INSERT INTO platform_audit(id,tenant_id,actor,scene_id,action,result) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), tenant, reviewer, scene, `business.publish.${decision}`, "success"],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return { ...row, publishedAt: String(row.publishedAt), reviewedAt: String(row.reviewedAt), active: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  /** 原子切换地区活动版本，保留上个版本以支持灰度外读取和恢复。 */
  async activatePublication(tenant: string, scene: string, revision: number, actor: string, trafficPercent = 100) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const item = await client.query<{ approval_status: string }>(
        "SELECT approval_status FROM scene_publication WHERE tenant_id=$1 AND scene_id=$2 AND revision=$3 FOR UPDATE",
        [tenant, scene, revision],
      );
      if (!item.rowCount) throw new ConflictException("发布版本不存在");
      if (item.rows[0].approval_status !== "approved")
        throw new ConflictException("发布版本尚未审批通过");
      const previous = await client.query<{ revision: number }>(
        "SELECT revision FROM scene_active_publication WHERE tenant_id=$1 AND scene_id=$2 FOR UPDATE",
        [tenant, scene],
      );
      const previousRevision = previous.rows[0]?.revision;
      if (previousRevision !== undefined && Number(previousRevision) === revision)
        throw new ConflictException("该版本已是当前活动版本");
      await client.query(
        `INSERT INTO scene_active_publication(tenant_id,scene_id,revision,activated_by,traffic_percent,previous_revision)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,scene_id) DO UPDATE
          SET revision=EXCLUDED.revision,activated_by=EXCLUDED.activated_by,
              traffic_percent=EXCLUDED.traffic_percent,previous_revision=EXCLUDED.previous_revision,activated_at=now()`,
        [tenant, scene, revision, actor, trafficPercent, previousRevision ?? null],
      );
      await client.query(
        "UPDATE scene_publication SET activated_at=now() WHERE tenant_id=$1 AND scene_id=$2 AND revision=$3",
        [tenant, scene, revision],
      );
      await client.query(
        "INSERT INTO platform_audit(id,tenant_id,actor,scene_id,action,result) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), tenant, actor, scene, "business.publish.activate", "success"],
      );
      await client.query("COMMIT");
      return (await this.activePublication(tenant, scene))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async rollbackBusiness(
    tenant: string,
    scene: string,
    targetRevision: number,
    expectedRevision: number,
    actor: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ revision: number }>(
        "SELECT revision FROM scene_business WHERE tenant_id=$1 AND scene_id=$2 FOR UPDATE",
        [tenant, scene],
      );
      if (!current.rowCount || Number(current.rows[0].revision) !== expectedRevision)
        throw new ConflictException("资料修订冲突，请重新加载后再回滚");
      const publication = await client.query<{ snapshot: BusinessData }>(
        "SELECT snapshot FROM scene_publication WHERE tenant_id=$1 AND scene_id=$2 AND revision=$3",
        [tenant, scene, targetRevision],
      );
      if (!publication.rowCount) throw new ConflictException("发布版本不存在");
      const data = publication.rows[0].snapshot;
      const updated = await client.query<{ revision: number; data: BusinessData }>(
        "UPDATE scene_business SET revision=revision+1,data=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND scene_id=$2 AND revision=$4 RETURNING revision,data",
        [tenant, scene, JSON.stringify(data), expectedRevision],
      );
      await this.syncBusinessEntities(client, tenant, scene, updated.rows[0].data);
      await client.query(
        "INSERT INTO platform_audit(id,tenant_id,actor,scene_id,action,result) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), tenant, actor, scene, "business.rollback", "success"],
      );
      await client.query("COMMIT");
      return { revision: Number(updated.rows[0].revision), data: updated.rows[0].data };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
