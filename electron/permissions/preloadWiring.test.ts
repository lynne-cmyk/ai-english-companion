import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repositoryRoot = path.resolve(__dirname, "../..");

test("Permission Setup BrowserWindow uses the isolated preload securely", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  assert.match(
    mainSource,
    /function createPermissionSetupWindow\(\)[\s\S]*preload:\s*path\.join\(__dirname,\s*"permissions\/preload\.js"\)/,
  );
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
});

test("packaging allowlist contains only the required permission runtime files", () => {
  const builderConfig = readFileSync(
    path.join(repositoryRoot, "electron-builder.yml"),
    "utf8",
  );
  for (const artifact of [
    "dist-electron/permissions/contracts.js",
    "dist-electron/permissions/menuBarIcon.js",
    "dist-electron/permissions/permissionState.js",
    "dist-electron/permissions/permissionSetupWindow.js",
    "dist-electron/permissions/preload.js",
    "dist-electron/permissions/setupPresentation.js",
  ]) {
    assert.match(builderConfig, new RegExp(`- ${artifact.replaceAll(".", "\\.")}`));
  }
  assert.doesNotMatch(builderConfig, /dist-electron\/permissions\/\*\*/);
});

test("compiled preload exposes only the narrow permissionState bridge", async () => {
  const exposed = new Map<string, unknown>();
  const invocations: string[] = [];
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const state = {
    status: "ready",
    accessibility: "granted",
    inputMonitoring: "operational",
    revision: 1,
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld(name: string, value: unknown) {
        exposed.set(name, value);
      },
    },
    ipcRenderer: {
      invoke(channel: string) {
        invocations.push(channel);
        return Promise.resolve(
          channel === "permission-state:get" ||
            channel === "permission-state:recheck"
            ? state
            : undefined,
        );
      },
      on(channel: string, listener: (...args: unknown[]) => void) {
        listeners.set(channel, listener);
      },
      removeListener(channel: string) {
        listeners.delete(channel);
      },
    },
  };

  vm.runInNewContext(
    readFileSync(path.join(__dirname, "preload.js"), "utf8"),
    {
      exports: {},
      require(name: string) {
        if (name === "electron") return electron;
        throw new Error(`Unexpected preload dependency: ${name}`);
      },
    },
  );

  assert.deepEqual([...exposed.keys()], ["permissionState"]);
  const bridge = exposed.get("permissionState") as {
    getState(): Promise<unknown>;
    recheck(): Promise<unknown>;
    openAccessibilitySettings(): Promise<void>;
    openInputMonitoringSettings(): Promise<void>;
    relaunch(): Promise<void>;
    onStateChange(listener: (value: unknown) => void): () => void;
  };
  assert.deepEqual(Object.keys(bridge).sort(), [
    "getState",
    "onStateChange",
    "openAccessibilitySettings",
    "openInputMonitoringSettings",
    "recheck",
    "relaunch",
  ]);
  assert.equal("ipcRenderer" in bridge, false);
  assert.equal("openExternal" in bridge, false);
  assert.deepEqual(await bridge.getState(), state);
  assert.deepEqual(await bridge.recheck(), state);
  await bridge.openAccessibilitySettings();
  await bridge.openInputMonitoringSettings();
  await bridge.relaunch();
  assert.deepEqual(invocations, [
    "permission-state:get",
    "permission-state:recheck",
    "permission-state:open-accessibility-settings",
    "permission-state:open-input-monitoring-settings",
    "permission-state:relaunch",
  ]);

  let changedState: unknown = null;
  const unsubscribe = bridge.onStateChange((value) => {
    changedState = value;
  });
  listeners.get("permission-state:changed")?.({}, state);
  assert.deepEqual(changedState, state);
  unsubscribe();
  assert.equal(listeners.has("permission-state:changed"), false);
});

test("settings and relaunch IPC remain fixed, narrow main-process actions", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  assert.match(mainSource, /Privacy_Accessibility/);
  assert.match(mainSource, /Privacy_ListenEvent/);
  assert.match(mainSource, /app\.relaunch\(\)/);
  assert.doesNotMatch(
    readFileSync(path.join(repositoryRoot, "electron/permissions/preload.ts"), "utf8"),
    /openExternal|shell\.|child_process|exposeInMainWorld\([^,]+,\s*ipcRenderer/,
  );
});

test("packaged startup is menu-bar-first and Technical Spike stays development-only", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  assert.match(mainSource, /new Tray\(createMenuBarIcon\(\)\)/);
  assert.match(mainSource, /let menuBarTray: Tray \| null = null/);
  assert.match(mainSource, /menuBarTray = new Tray\(createMenuBarIcon\(\)\)/);
  assert.match(mainSource, /menuBarTray\?\.destroy\(\)/);
  assert.match(mainSource, /app\.setActivationPolicy\("accessory"\)/);
  assert.match(
    mainSource,
    /if \(shouldCreateTechnicalSpikeWindow\(app\.isPackaged\)\)/,
  );
});

test("menu bar keeps the expected fixed product actions", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  assert.match(mainSource, /label: "Tirva", enabled: false/);
  assert.match(mainSource, /label: "权限设置…"/);
  assert.match(mainSource, /label: "退出 Tirva"/);
  assert.match(mainSource, /\[tray\] creation attempted/);
  assert.match(mainSource, /\[tray\] context menu attached/);
});

test("closing Permission Setup hides it without quitting the menu-bar app", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  const closeHandler = mainSource.match(
    /permissionWindow\.on\("close",[\s\S]*?\n  \}\);/,
  )?.[0];
  assert.ok(closeHandler);
  assert.match(closeHandler, /event\.preventDefault\(\)/);
  assert.match(closeHandler, /permissionSetupWindows\.hide\(\)/);
  assert.doesNotMatch(closeHandler, /app\.quit/);
});

test("menu and automatic permission setup opens carry explicit lifecycle reasons", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  assert.match(mainSource, /showPermissionSetupWindow\("manual"\)/);
  assert.match(mainSource, /showPermissionSetupWindow\("automatic"\)/);
  assert.doesNotMatch(mainSource, /showPermissionSetupWindow\(\)/);
  assert.match(
    mainSource,
    /permissionSetupWindows\.takeReadyAutoHideRequest\(\)/,
  );
});

test("existing popover and selection-action preload surfaces remain present", () => {
  assert.match(
    readFileSync(path.join(repositoryRoot, "electron/preload.ts"), "utf8"),
    /exposeInMainWorld\("translatorPopover"/,
  );
  assert.match(
    readFileSync(
      path.join(repositoryRoot, "electron/selection/preload.ts"),
      "utf8",
    ),
    /exposeInMainWorld\("selectionAction"/,
  );
});
