import { expect, test } from "vitest";
import { ImageryRecovery } from "../apps/web/src/imageryRecovery";
test("孤立缺瓦仅重试和保留影像，授权拒绝立即回退，持续故障才回退", () => {
  const recovery = new ImageryRecovery();
  const first = { timesRetried: 0, retry: false };
  expect(recovery.record(first, 0)).toBe("retry");
  expect(first.retry).toBe(true);
  expect(recovery.record({ timesRetried: 1, retry: false }, 1)).toBe("keep");
  expect(recovery.record({ timesRetried: 1, retry: false }, 15000)).toBe("keep");
  for (let i = 0; i < 6; i++) expect(recovery.record({ timesRetried: 1, retry: false }, 15001 + i)).toBe("keep");
  expect(recovery.record({ timesRetried: 1, retry: false }, 15008)).toBe("fallback");
  expect(new ImageryRecovery().record({ timesRetried: 0, retry: false, error: { statusCode: 403 } })).toBe("fallback");
});
