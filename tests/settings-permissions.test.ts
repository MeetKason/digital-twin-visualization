import { expect, test } from "vitest";
import { ScenarioPackSchema, effectiveSettingsSections } from "@dtv/contracts";
import xian from "../scenarios/xian.json";

test("场景包上限与账号授权取交集；最高管理员保留全部菜单", () => {
  expect(effectiveSettingsSections(["scenarios", "audit"], ["audit", "accounts"], "admin", false))
    .toEqual(["audit"]);
  expect(effectiveSettingsSections([], ["audit"], "admin", false)).toEqual([]);
  expect(effectiveSettingsSections(["audit"], undefined, "editor", false)).toEqual([]);
  expect(effectiveSettingsSections([], [], "admin", true)).toContain("accounts");
});

test("场景包校验系统管理子菜单，旧包仍可读取", () => {
  const base = {
    formatVersion: 1,
    coreApi: 1,
    scene: { ...xian, ui: { menus: ["home", "settings"], theme: { primary: "#1263c4", navy: "#1c466c" }, layout: { panelWidth: 264, timelineHeight: 112 } } },
  };
  expect(ScenarioPackSchema.safeParse(base).success).toBe(true);
  expect(ScenarioPackSchema.safeParse({ ...base, scene: { ...base.scene, ui: { ...base.scene.ui, settingsSections: ["audit"] } } }).success).toBe(true);
  expect(ScenarioPackSchema.safeParse({ ...base, scene: { ...base.scene, ui: { ...base.scene.ui, settingsSections: ["audit", "audit"] } } }).success).toBe(false);
});
