import { it, expect, vi } from "vitest";
import { AsyncResourceOwner } from "../apps/web/src/business/ownedResource";
it("关闭或切换预览后，异步返回的资源必须释放", async () => {
  const owner = new AsyncResourceOwner();
  let resolve!: (cleanup: () => void) => void;
  const cleanup = vi.fn();
  const pending = owner.replace(
    () =>
      new Promise<() => void>((r) => {
        resolve = r;
      }),
  );
  owner.dispose();
  resolve(cleanup);
  await pending;
  expect(cleanup).toHaveBeenCalledOnce();
  const other = new AsyncResourceOwner();
  let finish!: (cleanup: () => void) => void;
  const old = vi.fn(),
    current = vi.fn();
  const first = other.replace(
    () =>
      new Promise<() => void>((r) => {
        finish = r;
      }),
  );
  await other.replace(async () => current);
  finish(old);
  await first;
  expect(old).toHaveBeenCalledOnce();
  expect(current).not.toHaveBeenCalled();
  other.dispose();
  expect(current).toHaveBeenCalledOnce();
});
