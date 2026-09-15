import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repositoryRoot = path.resolve(__dirname, "../..");

test("compiled preload exposes only the narrow API Key setup bridge", async () => {
  const exposed = new Map<string, unknown>();
  const invocations: Array<{ channel: string; value?: unknown }> = [];
  const state = { status: "ready", configured: true };
  const action = { ok: true, state };
  const electron = {
    contextBridge: {
      exposeInMainWorld(name: string, value: unknown) {
        exposed.set(name, value);
      },
    },
    ipcRenderer: {
      invoke(channel: string, value?: unknown) {
        invocations.push({ channel, value });
        return Promise.resolve(channel.endsWith("get-state") ? state : action);
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

  assert.deepEqual([...exposed.keys()], ["apiKeySetup"]);
  const bridge = exposed.get("apiKeySetup") as Record<string, (...args: never[]) => Promise<unknown>>;
  assert.deepEqual(Object.keys(bridge).sort(), [
    "deleteApiKey",
    "getState",
    "setApiKey",
  ]);
  assert.equal("getApiKey" in bridge, false);
  assert.equal("ipcRenderer" in bridge, false);
  assert.deepEqual(await bridge.getState(), state);
  assert.deepEqual(await bridge.setApiKey("entered-by-user" as never), action);
  assert.deepEqual(await bridge.deleteApiKey(), action);
  assert.deepEqual(invocations, [
    { channel: "api-key-setup:get-state", value: undefined },
    { channel: "api-key-setup:set-api-key", value: "entered-by-user" },
    { channel: "api-key-setup:delete-api-key", value: undefined },
  ]);
});

test("packaging and renderer entrypoints include only required API Key setup runtime", () => {
  const builderConfig = readFileSync(
    path.join(repositoryRoot, "electron-builder.yml"),
    "utf8",
  );
  const viteConfig = readFileSync(
    path.join(repositoryRoot, "vite.config.mts"),
    "utf8",
  );
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );

  for (const artifact of [
    "dist-electron/secrets/apiKeySetupWindow.js",
    "dist-electron/secrets/contracts.js",
    "dist-electron/secrets/preload.js",
    "dist-electron/secrets/safeStorageCipher.js",
    "dist-electron/secrets/secretStore.js",
  ]) {
    assert.match(builderConfig, new RegExp(`- ${artifact.replaceAll(".", "\\.")}`));
  }
  assert.doesNotMatch(builderConfig, /dist-electron\/secrets\/\*\*/);
  assert.match(builderConfig, /- dist\/api-key-setup\.html/);
  assert.match(viteConfig, /apiKeySetup:[\s\S]*api-key-setup\.html/);
  assert.match(mainSource, /label: "AI 服务设置…"/);
  assert.match(mainSource, /preload: path\.join\(__dirname, "secrets\/preload\.js"\)/);
  assert.match(
    mainSource,
    /function isApiKeySetupSender[\s\S]*event\.sender === setupWindow\.webContents[\s\S]*event\.senderFrame === setupWindow\.webContents\.mainFrame/,
  );
  assert.doesNotMatch(mainSource, /apiKeyStore\.getApiKey\(/);

  const closeHandler = mainSource.match(
    /setupWindow\.on\("close",[\s\S]*?\n  \}\);/,
  )?.[0];
  assert.ok(closeHandler);
  assert.match(closeHandler, /event\.preventDefault\(\)/);
  assert.match(closeHandler, /apiKeySetupWindows\.hide\(\)/);
  assert.doesNotMatch(closeHandler, /app\.quit/);
});

test("renderer bridge has no stored-secret read capability", () => {
  const preloadSource = readFileSync(
    path.join(repositoryRoot, "electron/secrets/preload.ts"),
    "utf8",
  );
  const publicContracts = readFileSync(
    path.join(repositoryRoot, "electron/secrets/contracts.ts"),
    "utf8",
  );
  assert.doesNotMatch(preloadSource, /getApiKey|safeStorage|userData|readFile/);
  assert.doesNotMatch(publicContracts, /getApiKey|ciphertext|userData|safeStorage/);

  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  const apiKeyLogStatements = mainSource
    .split("\n")
    .filter((line) => line.includes("console.") && line.includes("api-key"));
  assert.equal(apiKeyLogStatements.some((line) => line.includes("apiKey")), false);
});
