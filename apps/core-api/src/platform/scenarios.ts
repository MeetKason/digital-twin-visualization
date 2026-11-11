import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  ScenarioDocumentSchema,
  ScenarioPackSchema,
  type ScenarioDocument,
  type ScenarioRevision,
  type SceneConfig,
} from "@dtv/contracts";
import type { Principal, Repository } from "./repository";
import { DemoService } from "../service";

/** 按租户解析生效场景；内置JSON只作默认配置，绝不把草稿泄露到普通查询。 */
export class ScenarioCatalog {
  private defaults = new DemoService();
  constructor(private readonly repo: Repository) {}
  private authorize(user: Principal, id: string) {
    if (user.role !== "admin" || !user.scenes.includes(id))
      throw new ForbiddenException("仅有该地区授权的管理员可管理场景包");
  }
  private async stored(
    tenant: string,
    id: string,
  ): Promise<ScenarioRevision | null> {
    const record = await this.repo.readConfiguration(tenant, `scenario:${id}`);
    if (!record) return null;
    const data = ScenarioDocumentSchema.safeParse(record.data);
    if (
      !data.success ||
      [
        data.data.draft,
        data.data.published,
        ...data.data.history.map((item) => item.pack),
      ].some((pack) => pack && pack.scene.id !== id)
    )
      throw new BadRequestException("已保存的场景配置无效，请联系维护人员");
    return { revision: record.revision, data: data.data };
  }
  async active(tenant: string, id: string): Promise<SceneConfig> {
    const record = await this.stored(tenant, id);
    if (record?.data.published) {
      const pack = record.data.published;
      return {
        ...pack.scene,
        revision: `runtime-${record.data.history.at(-1)?.revision ?? 0}-${pack.scene.revision}`,
      };
    }
    const builtin = this.defaults.scenes().find((scene) => scene.id === id);
    if (!builtin) throw new NotFoundException("场景尚未发布或不存在");
    return builtin;
  }
  async list(user: Principal) {
    const scenes: SceneConfig[] = [];
    for (const id of new Set(user.scenes)) {
      try {
        scenes.push(await this.active(user.tenantId, id));
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return scenes;
  }
  async read(user: Principal, id: string): Promise<ScenarioRevision> {
    this.authorize(user, id);
    const stored = await this.stored(user.tenantId, id);
    if (stored) return stored;
    const builtin = this.defaults.scenes().find((scene) => scene.id === id);
    return {
      revision: 0,
      data: {
        draft: builtin
          ? ScenarioPackSchema.parse({
              formatVersion: 1,
              coreApi: 1,
              scene: builtin,
            })
          : null,
        published: null,
        history: [],
      },
    };
  }
  private async write(
    user: Principal,
    id: string,
    expected: number,
    data: ScenarioDocument,
    action: string,
  ) {
    if (!Number.isSafeInteger(expected) || expected < 0)
      throw new BadRequestException("配置修订号无效");
    const record = await this.repo.saveConfiguration(
      user.tenantId,
      `scenario:${id}`,
      expected,
      data,
      user.id,
      action,
    );
    return {
      revision: record.revision,
      data: ScenarioDocumentSchema.parse(record.data),
    };
  }
  async saveDraft(user: Principal, id: string, expected: number, raw: unknown) {
    const current = await this.read(user, id);
    if (Buffer.byteLength(JSON.stringify(raw) ?? "") > 128 * 1024)
      throw new BadRequestException("场景包不能超过128KB");
    const parsed = ScenarioPackSchema.safeParse(raw);
    if (!parsed.success || parsed.data.scene.id !== id)
      throw new BadRequestException("场景包格式、依赖、版本或地区ID无效");
    if (expected !== current.revision)
      throw new ConflictException("配置修订冲突，请重新加载");
    return this.write(
      user,
      id,
      expected,
      { ...current.data, draft: parsed.data },
      "scenario.draft",
    );
  }
  async publish(user: Principal, id: string, expected: number) {
    const current = await this.read(user, id);
    if (expected !== current.revision)
      throw new ConflictException("配置修订冲突，请重新加载");
    if (!current.data.draft) throw new BadRequestException("没有可发布的草稿");
    const pack = current.data.draft;
    return this.write(
      user,
      id,
      expected,
      {
        ...current.data,
        published: pack,
        history: [
          ...current.data.history,
          {
            revision: expected + 1,
            pack,
            actor: user.id,
            at: new Date().toISOString(),
          },
        ].slice(-20),
      },
      "scenario.publish",
    );
  }
  async restore(user: Principal, id: string, expected: number, target: number) {
    const current = await this.read(user, id);
    if (expected !== current.revision)
      throw new ConflictException("配置修订冲突，请重新加载");
    const snapshot = current.data.history.find(
      (item) => item.revision === target,
    );
    if (!snapshot)
      throw new NotFoundException("历史场景版本不存在或已超出保留范围");
    return this.write(
      user,
      id,
      expected,
      { ...current.data, draft: snapshot.pack },
      "scenario.restore",
    );
  }
}
