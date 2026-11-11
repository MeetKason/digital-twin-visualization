import { z } from "zod";
import { readFileSync } from "node:fs";
import { BadRequestException } from "@nestjs/common";
import { parseProviderFrame } from "@dtv/sdk";
import { hourlyTime } from "@dtv/contracts";
const schema = z
  .array(
    z
      .object({
        tenantId: z.string().min(1).max(64),
        datasetKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        url: z.url().refine((value) => {
          const u = new URL(value);
          return (
            ["http:", "https:"].includes(u.protocol) &&
            !u.username &&
            !u.password &&
            !u.search &&
            !u.hash
          );
        }),
        tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/),
        source: z.enum(["mock", "tianqing", "other"]),
        unit: z.string().max(20),
      })
      .strict(),
  )
  .max(100);
/** 独立扩展服务仅从服务器配置映射，浏览器传逻辑ID，不能指定地址或令牌。 */
export class ExtensionServices {
  private entries: z.infer<typeof schema>;
  constructor(
    raw: unknown = process.env.DTV_EXTENSION_SERVICES_FILE
      ? JSON.parse(
          readFileSync(process.env.DTV_EXTENSION_SERVICES_FILE, "utf8"),
        )
      : [],
  ) {
    this.entries = schema.parse(raw);
    if (
      new Set(
        this.entries.map((v) => JSON.stringify([v.tenantId, v.datasetKey])),
      ).size !== this.entries.length
    )
      throw new Error("扩展服务租户/数据集重复");
  }
  has(tenant: string, dataset: string) {
    return this.entries.some(
      (v) => v.tenantId === tenant && v.datasetKey === dataset,
    );
  }
  private async read(
    tenant: string,
    dataset: string,
    time: string,
    signal: AbortSignal = AbortSignal.timeout(10000),
  ) {
    const service = this.entries.find(
      (v) => v.tenantId === tenant && v.datasetKey === dataset,
    );
    if (!service || !hourlyTime.safeParse(time).success)
      throw new BadRequestException("扩展数据集或时次无效");
    const token = process.env[service.tokenEnv];
    if (!token || token.length < 32)
      throw new BadRequestException("扩展服务认证未配置");
    const url = new URL(service.url);
    url.search = new URLSearchParams({ sceneId: "", time }).toString();
    return { service, url, token, signal };
  }
  async observations(
    tenant: string,
    scene: string,
    dataset: string,
    time: string,
    signal?: AbortSignal,
  ) {
    const { service, url, token } = await this.read(tenant, dataset, time);
    url.searchParams.set("sceneId", scene);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, "X-DTV-Tenant": tenant },
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      });
      if (
        !response.ok ||
        Number(response.headers.get("content-length") ?? 0) > 1024 * 1024 ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new Error();
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 1024 * 1024) throw new Error();
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const frame = parseProviderFrame(value, service.source, time);
      if (frame.unit !== service.unit) throw new Error();
      return frame;
    } catch {
      throw new BadRequestException(
        "扩展服务读取或合同校验失败，请检查服务端日志与配置",
      );
    }
  }
}
