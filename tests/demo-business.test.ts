import { expect, test } from "vitest";
import { createDemoBusiness } from "../apps/core-api/src/platform/demoBusiness";
import { parseBusinessData, validatePlan, SceneSchema } from "@dtv/contracts";
import xian from "../scenarios/xian.json";

test("演示预置包含可验证的多点路线和站点视角，各次创建互不污染", () => {
  const data = createDemoBusiness(SceneSchema.parse(xian));
  expect(parseBusinessData(data, "xian")).toEqual(data);
  expect(data.plans).toHaveLength(2);
  for (const plan of data.plans) {
    expect(plan.points.length).toBeGreaterThanOrEqual(3);
    expect(plan.routeHeightM).toBe(800);
    expect(() => validatePlan(plan)).not.toThrow();
    expect(() => validatePlan({ ...plan, routeHeightM: -1 })).toThrow("线路离地高度");
    expect(() => validatePlan({ ...plan, routeHeightM: 10001 })).toThrow("线路离地高度");
  }
  expect(data.bookmarks).toHaveLength(3);
  expect(data.bookmarks[0].view.heading).toBeCloseTo(Math.PI);
  expect(data.bookmarks[0].view.pitch).toBeCloseTo(-Math.PI / 4);
  expect(data.stations.slice(0, 3).every((s) => s.bookmarkId)).toBe(true);
  data.plans[0].points.length = 0;
  expect(createDemoBusiness(SceneSchema.parse(xian)).plans[0].points).toHaveLength(3);
});
