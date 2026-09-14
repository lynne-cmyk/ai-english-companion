import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionStateSnapshot } from "./contracts";
import {
  menuStatusLabel,
  permissionSetupViewModel,
  shouldAutoOpenPermissionSetup,
  shouldCreateTechnicalSpikeWindow,
} from "./setupPresentation";

function state(
  status: PermissionStateSnapshot["status"],
  overrides: Partial<PermissionStateSnapshot> = {},
): PermissionStateSnapshot {
  return {
    status,
    accessibility: "unknown",
    inputMonitoring: "unknown",
    revision: 1,
    ...overrides,
  };
}

test("ready stays menu-bar-only on normal production startup", () => {
  assert.equal(shouldAutoOpenPermissionSetup("ready"), false);
  assert.equal(shouldAutoOpenPermissionSetup("checking"), false);
  assert.equal(shouldCreateTechnicalSpikeWindow(true), false);
  assert.equal(shouldCreateTechnicalSpikeWindow(false), true);
});

test("ready state provides the automatic setup completion feedback", () => {
  const model = permissionSetupViewModel(
    state("ready", {
      accessibility: "granted",
      inputMonitoring: "operational",
    }),
  );
  assert.equal(model.title, "设置完成");
  assert.equal(model.explanation, "现在双击英文单词即可使用。");
  assert.equal(model.accessibilityRow, "complete");
  assert.equal(model.inputMonitoringRow, "complete");
  assert.equal(model.isSuccess, true);
});

test("all resolved recovery states open Permission Setup", () => {
  for (const status of [
    "needs_accessibility",
    "needs_input_monitoring",
    "needs_both",
    "helper_unavailable",
    "indeterminate",
  ] as const) {
    assert.equal(shouldAutoOpenPermissionSetup(status), true);
  }
});

test("Accessibility state shows its fixed settings action", () => {
  const model = permissionSetupViewModel(state("needs_accessibility"));
  assert.equal(model.title, "允许读取所选单词");
  assert.equal(model.primaryAction, "open_accessibility");
  assert.equal(model.accessibilityRow, "current");
});

test("Input Monitoring state shows restart-safe guidance", () => {
  const model = permissionSetupViewModel(
    state("needs_input_monitoring", { accessibility: "granted" }),
  );
  assert.equal(model.primaryAction, "open_input_monitoring");
  assert.equal(model.inputMonitoringRow, "current");
  const restart = permissionSetupViewModel(
    state("needs_input_monitoring", { accessibility: "granted" }),
    true,
  );
  assert.equal(restart.primaryAction, "relaunch");
  assert.match(restart.explanation, /重新打开/);
});

test("needs both guides Accessibility first", () => {
  const model = permissionSetupViewModel(state("needs_both"));
  assert.equal(model.primaryAction, "open_accessibility");
  assert.equal(model.accessibilityRow, "current");
  assert.equal(model.inputMonitoringRow, "pending");
});

test("exceptional states stay conservative and recoverable", () => {
  const unavailable = permissionSetupViewModel(state("helper_unavailable"));
  assert.equal(unavailable.primaryLabel, "重试");
  assert.equal(unavailable.secondaryAction, "relaunch");
  assert.match(unavailable.fallback ?? "", /复制单词/);
  assert.equal(unavailable.showPermissionRows, false);

  const indeterminate = permissionSetupViewModel(state("indeterminate"));
  assert.equal(indeterminate.title, "暂时无法确认权限状态");
  assert.doesNotMatch(indeterminate.explanation, /拒绝|缺少/);
  assert.equal(indeterminate.showPermissionRows, false);
});

test("menu status mapping is deliberately small", () => {
  assert.equal(menuStatusLabel("ready"), "● 已就绪");
  assert.equal(menuStatusLabel("checking"), "● 正在检查");
  assert.equal(menuStatusLabel("needs_both"), "● 需要设置权限");
  assert.equal(menuStatusLabel("helper_unavailable"), "● 需要设置权限");
});
