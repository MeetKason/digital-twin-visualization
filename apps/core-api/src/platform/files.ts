import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  HttpException,
} from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { validateUpload, type Asset } from "@dtv/contracts";
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_SCENE_FILE_QUOTA_BYTES = 1024 * 1024 * 1024;
type StoredFile = { id: string; name: string; size: number; type: string };
export class FileStore {
  private uploading = 0;
  private readonly activeScopes = new Set<string>();
  private readonly quotaBytes: number;
  constructor(private readonly root: string, quotaBytes = Number(process.env.FILE_SCENE_QUOTA_BYTES ?? DEFAULT_SCENE_FILE_QUOTA_BYTES)) {
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1)
      throw new Error("FILE_SCENE_QUOTA_BYTES 必须是正安全整数");
    this.quotaBytes = quotaBytes;
  }
  /** 同一场景只允许一个上传计入配额，防止并发请求同时越过容量检查。 */
  private reserveScope(tenant: string, scene: string) {
    const key = this.scope(tenant, scene);
    if (this.activeScopes.has(key)) throw new HttpException("当前地区有文件正在上传，请稍后重试", 429);
    this.activeScopes.add(key);
    return () => this.activeScopes.delete(key);
  }
  private async usedBytes(tenant: string, scene: string) {
    return (await this.list(tenant, scene)).reduce((sum, file) => sum + file.size, 0);
  }
  private scope(tenant: string, scene: string) {
    return join(
      this.root,
      createHash("sha256")
        .update(JSON.stringify([tenant, scene]))
        .digest("hex"),
    );
  }
  private path(tenant: string, scene: string, id: string) {
    if (
      !/^srv_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        id,
      )
    )
      throw new NotFoundException("文件不存在");
    return join(this.scope(tenant, scene), id);
  }
  async metadata(
    tenant: string,
    scene: string,
    id: string,
  ): Promise<StoredFile> {
    // 上传前限制编码类型、大小和文件名；内容仍需由契约校验器复核。
    try {
      return JSON.parse(
        await readFile(join(this.path(tenant, scene, id), "meta.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new NotFoundException("文件不存在或不属于当前地区");
      throw e;
    }
  }
  async upload(
    tenant: string,
    scene: string,
    req: IncomingMessage,
  ): Promise<StoredFile> {
    if (req.headers["content-type"] !== "application/octet-stream")
      throw new BadRequestException("请使用二进制上传");
    if (Number(req.headers["content-length"]) > MAX_FILE_BYTES)
      throw new PayloadTooLargeException("文件不得超过100MB");
    let name: string;
    try {
      name = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
    } catch {
      throw new BadRequestException("文件名编码错误");
    }
    if (
      !name ||
      name.length > 240 ||
      /[/\\]/.test(name) ||
      [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      !/\.(glb|gltf|pdf|mp4|webm)$/i.test(name)
    )
      throw new BadRequestException("不支持的文件名或类型");
    if (this.uploading >= 2)
      throw new HttpException("上传繁忙，请稍后重试", 429);
    const releaseScope = this.reserveScope(tenant, scene);
    this.uploading++;
    let temp: string | undefined;
    try {
      const dir = this.scope(tenant, scene);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const used = await this.usedBytes(tenant, scene);
      if (used + Number(req.headers["content-length"] || 0) > this.quotaBytes)
        throw new PayloadTooLargeException("当前地区文件容量配额不足");
      temp = await mkdtemp(join(dir, ".upload-"));
      const handle = await open(join(temp, "content"), "wx", 0o600);
      let size = 0;
      try {
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_FILE_BYTES)
            throw new PayloadTooLargeException("文件不得超过100MB");
          if (used + size > this.quotaBytes)
            throw new PayloadTooLargeException("当前地区文件容量配额不足");
          await handle.writeFile(bytes);
        }
      } finally {
        await handle.close();
      }
      let type: string;
      try {
        type = await validateUpload(
          new File([await readFile(join(temp, "content"))], name),
        );
      } catch {
        throw new BadRequestException("文件内容无效或模型包含外部资源");
      }
      const meta: StoredFile = { id: `srv_${randomUUID()}`, name, size, type };
      await writeFile(join(temp, "meta.json"), JSON.stringify(meta), {
        mode: 0o600,
      });
      await rename(temp, this.path(tenant, scene, meta.id));
      temp = undefined;
      return meta;
    } finally {
      this.uploading--;
      releaseScope();
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }
  /** 仅由隔离演示初始化调用，仍按真实文件规则校验并原子写入私有目录。 */
  async storeDemoFile(tenant: string, scene: string, file: File): Promise<StoredFile> {
    if (!/^Mock-[^/\\]+\.(gltf|pdf|webm)$/.test(file.name) || file.size > 1024 * 1024)
      throw new BadRequestException("演示文件名称或大小无效");
    const type = await validateUpload(file);
    const releaseScope = this.reserveScope(tenant, scene);
    const dir = this.scope(tenant, scene);
    let temp: string | undefined;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if ((await this.usedBytes(tenant, scene)) + file.size > this.quotaBytes)
        throw new PayloadTooLargeException("当前地区文件容量配额不足");
      temp = await mkdtemp(join(dir, ".upload-"));
      const meta: StoredFile = { id: `srv_${randomUUID()}`, name: file.name, size: file.size, type };
      await writeFile(join(temp, "content"), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
      await writeFile(join(temp, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
      await rename(temp, this.path(tenant, scene, meta.id));
      temp = undefined;
      return meta;
    } finally {
      releaseScope();
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }
  async list(tenant: string, scene: string) {
    let ids: string[];
    try {
      ids = await readdir(this.scope(tenant, scene));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return Promise.all(
      ids
        .filter((id) => id.startsWith("srv_"))
        .map((id) => this.metadata(tenant, scene, id)),
    );
  }
  async validateReferences(tenant: string, scene: string, assets: Asset[]) {
    // 保存业务资料时核对服务端文件元数据，阻止跨租户或已删除资源被引用。
    for (const asset of assets) {
      // Existing browser-only records remain readable and can be explicitly migrated.
      if (!asset.blobId.startsWith("srv_")) continue;
      try {
        const meta = await this.metadata(tenant, scene, asset.blobId);
        const kind = meta.type.startsWith("model/")
          ? "model"
          : meta.type.startsWith("video/")
            ? "video"
            : "document";
        if (
          meta.size !== asset.size ||
          meta.name !== asset.fileName ||
          kind !== asset.kind
        )
          throw new Error();
      } catch {
        throw new BadRequestException(
          "资源文件不存在、类型不匹配或不属于当前地区",
        );
      }
    }
  }
  async download(tenant: string, scene: string, id: string) {
    const meta = await this.metadata(tenant, scene, id);
    const handle = await open(
      join(this.path(tenant, scene, id), "content"),
      "r",
    );
    return { meta, stream: handle.createReadStream() };
  }
  async remove(tenant: string, scene: string, id: string) {
    await this.metadata(tenant, scene, id);
    await rm(this.path(tenant, scene, id), { recursive: true });
  }
}
