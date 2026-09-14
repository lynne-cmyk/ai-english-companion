import assert from "node:assert/strict";
import test from "node:test";
import {
  PermissionSetupWindowManager,
  type PermissionSetupWindowLike,
} from "./permissionSetupWindow";

class FakeWindow implements PermissionSetupWindowLike {
  destroyed = false;
  visible = false;
  showCount = 0;
  focusCount = 0;
  hideCount = 0;

  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible;
  }
  show() {
    this.visible = true;
    this.showCount += 1;
  }
  focus() {
    this.focusCount += 1;
  }
  hide() {
    this.visible = false;
    this.hideCount += 1;
  }
}

test("Permission Setup is a reusable singleton", () => {
  const manager = new PermissionSetupWindowManager<FakeWindow>();
  let createCount = 0;
  const create = () => {
    createCount += 1;
    return new FakeWindow();
  };
  const first = manager.ensure(create);
  const second = manager.ensure(create);
  assert.equal(first, second);
  assert.equal(createCount, 1);
  assert.equal(manager.show(), true);
  assert.equal(manager.show(), true);
  assert.equal(first.showCount, 1);
  assert.equal(first.focusCount, 2);
});

test("automatic setup requests one auto-hide after transitioning into ready", () => {
  const manager = new PermissionSetupWindowManager<FakeWindow>();
  manager.observePermissionStatus("needs_input_monitoring");
  manager.requestOpen("automatic");
  manager.ensure(() => new FakeWindow());
  manager.show();

  manager.observePermissionStatus("ready");
  assert.equal(manager.takeReadyAutoHideRequest(), true);
  assert.equal(manager.takeReadyAutoHideRequest(), false);
});

test("manual open while ready remains visible", () => {
  const manager = new PermissionSetupWindowManager<FakeWindow>();
  manager.observePermissionStatus("ready");
  manager.requestOpen("manual");
  const window = manager.ensure(() => new FakeWindow());
  manager.show();

  assert.equal(manager.takeReadyAutoHideRequest(), false);
  assert.equal(window.visible, true);
});

test("manual open while non-ready keeps the manual lifecycle context", () => {
  const manager = new PermissionSetupWindowManager<FakeWindow>();
  manager.observePermissionStatus("needs_accessibility");
  manager.requestOpen("manual");
  const window = manager.ensure(() => new FakeWindow());
  manager.show();

  manager.requestOpen("automatic");
  manager.observePermissionStatus("ready");
  assert.equal(manager.takeReadyAutoHideRequest(), false);
  assert.equal(window.visible, true);
});

test("manual open overrides a pending automatic ready auto-hide", () => {
  const manager = new PermissionSetupWindowManager<FakeWindow>();
  manager.observePermissionStatus("needs_both");
  manager.requestOpen("automatic");
  manager.ensure(() => new FakeWindow());
  manager.show();
  manager.observePermissionStatus("ready");

  manager.requestOpen("manual");
  assert.equal(manager.takeReadyAutoHideRequest(), false);
});

test("hiding or closing setup does not imply application quit", () => {
  const manager = new PermissionSetupWindowManager<FakeWindow>();
  const window = manager.ensure(() => new FakeWindow());
  manager.show();
  assert.equal(manager.hide(), true);
  assert.equal(window.visible, false);
  assert.equal(window.hideCount, 1);
  assert.equal(manager.current, window);
  assert.equal(manager.release(window), true);
  assert.equal(manager.current, null);
});

test("a destroyed setup window is replaced on the next request", () => {
  const manager = new PermissionSetupWindowManager<FakeWindow>();
  const first = manager.ensure(() => new FakeWindow());
  first.destroyed = true;
  const second = manager.ensure(() => new FakeWindow());
  assert.notEqual(first, second);
});
