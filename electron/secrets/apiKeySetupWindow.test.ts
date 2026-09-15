import assert from "node:assert/strict";
import test from "node:test";
import { ApiKeySetupWindowManager } from "./apiKeySetupWindow";

function createWindow() {
  return {
    destroyed: false,
    visible: false,
    showCount: 0,
    focusCount: 0,
    hideCount: 0,
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    show() { this.visible = true; this.showCount++; },
    focus() { this.focusCount++; },
    hide() { this.visible = false; this.hideCount++; },
  };
}

test("API Key setup window is a reusable singleton", () => {
  const manager = new ApiKeySetupWindowManager<ReturnType<typeof createWindow>>();
  let creations = 0;
  const first = manager.ensure(() => {
    creations++;
    return createWindow();
  });
  const second = manager.ensure(() => {
    creations++;
    return createWindow();
  });

  assert.equal(first, second);
  assert.equal(creations, 1);
  assert.equal(manager.show(), true);
  assert.equal(first.visible, true);
  assert.equal(first.showCount, 1);
  assert.equal(first.focusCount, 1);
  assert.equal(manager.hide(), true);
  assert.equal(first.visible, false);
  assert.equal(manager.release(first), true);
  assert.equal(manager.current, null);
});

test("a destroyed API Key setup window is replaced", () => {
  const manager = new ApiKeySetupWindowManager<ReturnType<typeof createWindow>>();
  const first = manager.ensure(createWindow);
  first.destroyed = true;
  const second = manager.ensure(createWindow);
  assert.notEqual(second, first);
});
