import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRepository } from "../apps/core-api/src/platform/repository";
import { isPublicationCohort } from "../apps/core-api/src/platform/platform";

it("灰度按用户稳定分桶，比例边界可控", () => {
  expect(isPublicationCohort("viewer-a", 100)).toBe(true);
  expect(isPublicationCohort("viewer-a", 0)).toBe(false);
  const bucket = Number.parseInt(
    createHash("sha256").update("viewer-a").digest("hex").slice(0, 8), 16,
  ) % 100;
  expect(isPublicationCohort("viewer-a", 25)).toBe(bucket < 25);
});

it("publishes a revision as an immutable tenant-scoped snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-publication-"));
  try {
    const repo = new FileRepository(dir);
    const original = { version: 1, stations: [{ id: "s1", name: "original" }] };
    await repo.saveBusiness("alpha", "xian", 0, original, "admin");
    const published = await repo.publishBusiness(
      "alpha",
      "xian",
      1,
      "admin",
      "验收发布",
    );
    expect(published).toMatchObject({
      tenantId: "alpha",
      sceneId: "xian",
      revision: 1,
      publisher: "admin",
      message: "验收发布",
      snapshot: original,
      approvalStatus: "pending_approval",
    });
    await expect(repo.activatePublication("alpha", "xian", 1, "approver"))
      .rejects.toThrow("尚未审批");
    await expect(repo.reviewPublication("alpha", "xian", 1, "admin", "approve", ""))
      .rejects.toThrow("发布者不能审批自己的版本");
    await expect(repo.reviewPublication("alpha", "xian", 1, "reviewer", "approve", "通过"))
      .resolves.toMatchObject({ approvalStatus: "approved", approvedBy: "reviewer" });
    const active = await repo.activatePublication("alpha", "xian", 1, "approver", 25);
    expect(active).toMatchObject({ approvalStatus: "approved", active: true, trafficPercent: 25 });
    expect(await repo.activePublication("alpha", "xian")).toMatchObject({ revision: 1, trafficPercent: 25 });
    await repo.saveBusiness(
      "alpha",
      "xian",
      1,
      { ...original, stations: [{ id: "s1", name: "changed" }] },
      "editor",
    );
    await repo.publishBusiness("alpha", "xian", 2, "admin", "灰度版本");
    await repo.reviewPublication("alpha", "xian", 2, "reviewer", "approve", "通过");
    const canary = await repo.activatePublication("alpha", "xian", 2, "approver", 10);
    expect(canary).toMatchObject({ active: true, trafficPercent: 10, previousRevision: 1 });
    expect(await repo.activePublication("alpha", "xian")).toMatchObject({
      revision: 2, trafficPercent: 10, previousRevision: 1,
    });
    expect((await repo.publications("alpha", "xian")).find((item) => item.revision === 1)?.snapshot).toEqual(original);
    expect(await repo.publications("beta", "xian")).toEqual([]);
    await expect(
      repo.publishBusiness("alpha", "xian", 1, "admin", "stale"),
    ).rejects.toThrow();
    await expect(
      repo.publishBusiness("alpha", "xian", 1, "admin", "duplicate"),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects a publication with a reason and keeps it out of active state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-publication-reject-"));
  try {
    const repo = new FileRepository(dir);
    await repo.saveBusiness("alpha", "xian", 0, { version: 1, stations: [] }, "author");
    await repo.publishBusiness("alpha", "xian", 1, "author", "待审版本");
    const rejected = await repo.reviewPublication(
      "alpha", "xian", 1, "reviewer", "reject", "站点字段需复核",
    );
    expect(rejected).toMatchObject({
      approvalStatus: "rejected", reviewMessage: "站点字段需复核",
    });
    expect(await repo.activePublication("alpha", "xian")).toBeNull();
    await expect(repo.activatePublication("alpha", "xian", 1, "admin"))
      .rejects.toThrow("尚未审批");
    await expect(repo.reviewPublication("beta", "xian", 1, "reviewer", "approve", ""))
      .rejects.toThrow("发布版本不存在");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("restores a published snapshot as a new draft revision without changing history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dtv-publication-rollback-"));
  try {
    const repo = new FileRepository(dir);
    const original = { version: 1, stations: [{ id: "s1", name: "published" }] };
    await repo.saveBusiness("alpha", "xian", 0, original, "admin");
    await repo.publishBusiness("alpha", "xian", 1, "admin", "版本一");
    await repo.saveBusiness("alpha", "xian", 1,
      { ...original, stations: [{ id: "s1", name: "draft" }] }, "admin");

    const restored = await repo.rollbackBusiness("alpha", "xian", 1, 2, "admin");
    expect(restored).toEqual({ revision: 3, data: original });
    expect((await repo.publications("alpha", "xian"))[0].snapshot).toEqual(original);
    expect((await repo.audit("alpha")).at(-1)?.action).toBe("business.rollback");
    await expect(repo.rollbackBusiness("alpha", "xian", 1, 2, "admin"))
      .rejects.toThrow("修订冲突");
    await repo.saveBusiness("beta", "xian", 0, original, "admin");
    await expect(repo.rollbackBusiness("beta", "xian", 1, 1, "admin"))
      .rejects.toThrow("发布版本不存在");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
