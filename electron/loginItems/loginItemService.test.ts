import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  LoginItemService,
  applyLoginItemStateToMenu,
  loginItemMenuPresentation,
  mapLoginItemStatus,
  refreshLoginItemMenu,
  type LoginItemApi,
  type MainAppServiceStatus,
} from "./loginItemService";

const repositoryRoot = path.resolve(__dirname, "../..");

class FakeLoginItemApi implements LoginItemApi {
  status: MainAppServiceStatus = "not-registered";
  getCalls = 0;
  setCalls: Array<{ openAtLogin: boolean; type: "mainAppService" }> = [];
  getError = false;
  setError = false;
  afterSet?: (enabled: boolean) => void;

  getLoginItemSettings(options: { type: "mainAppService" }) {
    assert.deepEqual(options, { type: "mainAppService" });
    this.getCalls += 1;
    if (this.getError) throw new Error("sensitive read detail");
    return { status: this.status };
  }

  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    type: "mainAppService";
  }) {
    this.setCalls.push(settings);
    if (this.setError) throw new Error("sensitive write detail");
    this.afterSet?.(settings.openAtLogin);
  }
}

function createService(
  api: FakeLoginItemApi,
  options: { isPackaged?: boolean; logs?: string[] } = {},
) {
  return new LoginItemService({
    api,
    isPackaged: options.isPackaged ?? true,
    log: (message) => options.logs?.push(message),
  });
}

function createMenuBindings() {
  return {
    toggle: { checked: false },
    approvalGuidance: { visible: false },
  };
}

test("enabled OS state renders the checkbox checked", () => {
  assert.equal(mapLoginItemStatus("enabled"), "enabled");
  assert.deepEqual(loginItemMenuPresentation("enabled"), {
    checked: true,
    showApprovalGuidance: false,
  });
});

test("not-registered OS state renders the checkbox unchecked", () => {
  assert.equal(mapLoginItemStatus("not-registered"), "disabled");
  assert.equal(loginItemMenuPresentation("disabled").checked, false);
});

test("reading the default OS state never enables a login item", () => {
  const api = new FakeLoginItemApi();
  const service = createService(api);

  assert.equal(service.getState(), "disabled");
  assert.equal(api.getCalls, 1);
  assert.deepEqual(api.setCalls, []);
});

test("requires-approval remains unchecked and shows guidance", () => {
  assert.equal(mapLoginItemStatus("requires-approval"), "requires_approval");
  assert.deepEqual(loginItemMenuPresentation("requires_approval"), {
    checked: false,
    showApprovalGuidance: true,
  });
});

test("not-found and unknown statuses map safely to unavailable", () => {
  for (const status of ["not-found", "future-status"]) {
    assert.equal(mapLoginItemStatus(status), "unavailable");
  }
  assert.deepEqual(loginItemMenuPresentation("unavailable"), {
    checked: false,
    showApprovalGuidance: false,
  });
});

test("enable requests mainAppService and re-reads the accepted OS state", () => {
  const api = new FakeLoginItemApi();
  api.afterSet = () => {
    api.status = "enabled";
  };
  const service = createService(api);

  assert.equal(service.setEnabled(true), "enabled");
  assert.deepEqual(api.setCalls, [
    { openAtLogin: true, type: "mainAppService" },
  ]);
  assert.equal(api.getCalls, 1);
});

test("disable requests mainAppService and re-reads the accepted OS state", () => {
  const api = new FakeLoginItemApi();
  api.status = "enabled";
  api.afterSet = () => {
    api.status = "not-registered";
  };
  const service = createService(api);

  assert.equal(service.setEnabled(false), "disabled");
  assert.deepEqual(api.setCalls, [
    { openAtLogin: false, type: "mainAppService" },
  ]);
  assert.equal(api.getCalls, 1);
});

test("requested enable does not claim success when approval is required", () => {
  const api = new FakeLoginItemApi();
  api.afterSet = () => {
    api.status = "requires-approval";
  };
  const service = createService(api);

  const state = service.setEnabled(true);
  assert.equal(state, "requires_approval");
  assert.equal(loginItemMenuPresentation(state).checked, false);
});

test("requested enable stays unchecked when the OS remains not-registered", () => {
  const api = new FakeLoginItemApi();
  const service = createService(api);

  const state = service.setEnabled(true);
  assert.equal(state, "disabled");
  assert.equal(loginItemMenuPresentation(state).checked, false);
});

test("get and set exceptions become safe unavailable states", () => {
  const logs: string[] = [];
  const readApi = new FakeLoginItemApi();
  readApi.getError = true;
  assert.equal(createService(readApi, { logs }).getState(), "unavailable");

  const writeApi = new FakeLoginItemApi();
  writeApi.setError = true;
  assert.equal(
    createService(writeApi, { logs }).setEnabled(true),
    "unavailable",
  );
  assert.deepEqual(logs, [
    "[login-item] read failed category=unavailable",
    "[login-item] write failed category=unavailable",
  ]);
  assert.equal(logs.some((message) => message.includes("sensitive")), false);
});

test("development mode never reads or mutates the real login item", () => {
  const api = new FakeLoginItemApi();
  const logs: string[] = [];
  const service = createService(api, { isPackaged: false, logs });

  assert.equal(service.getState(), "disabled");
  assert.equal(service.setEnabled(true), "disabled");
  assert.equal(api.getCalls, 0);
  assert.deepEqual(api.setCalls, []);
  assert.deepEqual(logs, [
    "[login-item] write ignored category=development",
  ]);
});

test("menu refresh reads the current OS state instead of cached intent", () => {
  const api = new FakeLoginItemApi();
  const service = createService(api);
  const bindings = createMenuBindings();

  assert.equal(refreshLoginItemMenu(service, bindings), "disabled");
  assert.equal(bindings.toggle.checked, false);

  api.status = "enabled";
  assert.equal(refreshLoginItemMenu(service, bindings), "enabled");
  assert.equal(bindings.toggle.checked, true);

  api.status = "requires-approval";
  assert.equal(refreshLoginItemMenu(service, bindings), "requires_approval");
  assert.deepEqual(bindings, {
    toggle: { checked: false },
    approvalGuidance: { visible: true },
  });
});

test("state application can immediately correct Electron checkbox intent", () => {
  const bindings = {
    toggle: { checked: true },
    approvalGuidance: { visible: false },
  };
  applyLoginItemStateToMenu("requires_approval", bindings);
  assert.deepEqual(bindings, {
    toggle: { checked: false },
    approvalGuidance: { visible: true },
  });
});

test("main-process menu wiring stays native, packaged-only, and IPC-free", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  const builderConfig = readFileSync(
    path.join(repositoryRoot, "electron-builder.yml"),
    "utf8",
  );

  assert.match(mainSource, /label: "登录时启动"/);
  assert.match(mainSource, /type: "checkbox"/);
  assert.match(mainSource, /menu-will-show/);
  assert.match(mainSource, /isPackaged: app\.isPackaged/);
  assert.match(
    builderConfig,
    /- dist-electron\/loginItems\/loginItemService\.js/,
  );
  assert.doesNotMatch(builderConfig, /dist-electron\/loginItems\/\*\*/);

  for (const preload of [
    "electron/preload.ts",
    "electron/permissions/preload.ts",
    "electron/secrets/preload.ts",
    "electron/selection/preload.ts",
  ]) {
    assert.doesNotMatch(
      readFileSync(path.join(repositoryRoot, preload), "utf8"),
      /login.?item/i,
    );
  }
});
