import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repositoryRoot = path.resolve(__dirname, "../..");

test("main BrowserWindow points at the isolated permission preload securely", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  assert.match(
    mainSource,
    /preload:\s*path\.join\(__dirname,\s*"permissions\/preload\.js"\)/,
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
    "dist-electron/permissions/permissionState.js",
    "dist-electron/permissions/preload.js",
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
        return Promise.resolve(state);
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
    onStateChange(listener: (value: unknown) => void): () => void;
  };
  assert.deepEqual(Object.keys(bridge).sort(), [
    "getState",
    "onStateChange",
    "recheck",
  ]);
  assert.equal("ipcRenderer" in bridge, false);
  assert.deepEqual(await bridge.getState(), state);
  assert.deepEqual(await bridge.recheck(), state);
  assert.deepEqual(invocations, ["permission-state:get", "permission-state:recheck"]);

  let changedState: unknown = null;
  const unsubscribe = bridge.onStateChange((value) => {
    changedState = value;
  });
  listeners.get("permission-state:changed")?.({}, state);
  assert.deepEqual(changedState, state);
  unsubscribe();
  assert.equal(listeners.has("permission-state:changed"), false);
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
