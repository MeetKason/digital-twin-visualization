import { expect, test } from "vitest";
import { createLatticeFlow, demoFlowFootprints, sampleLattice } from "../apps/web/src/flowLattice";

test("白膜格点保持静风，来流把开阔通道推向下游且不发散", () => {
  const solver = createLatticeFlow(72, 48, demoFlowFootprints, 0.06);
  for (let step = 0; step < 240; step++) solver.step();
  const blocked = sampleLattice(solver.flow, 0.3, 0.45);
  const open = sampleLattice(solver.flow, 0.12, 0.5);
  expect(blocked.solid).toBe(true);
  expect(blocked.speed).toBe(0);
  expect(open.solid).toBe(false);
  expect(open.ux).toBeGreaterThan(0.02);
  expect(solver.flow.speed.some((value) => !Number.isFinite(value))).toBe(false);
  expect(Math.max(...solver.flow.speed)).toBeLessThan(0.2);
});

test("街谷缝隙的风速高于建筑正下游的尾流", () => {
  const solver = createLatticeFlow(80, 56, demoFlowFootprints, 0.06);
  for (let step = 0; step < 360; step++) solver.step();
  const canyon = sampleLattice(solver.flow, 0.55, 0.52);
  const wake = sampleLattice(solver.flow, 0.43, 0.46);
  expect(canyon.solid).toBe(false);
  expect(wake.solid).toBe(false);
  expect(canyon.speed).toBeGreaterThan(wake.speed);
});
