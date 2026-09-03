import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { POPOVER_IPC_CHANNELS as channels, type PopoverStatePayload } from "./popoverIpc";

// Run the actual compiled main process with OS/network boundaries stubbed.
// No Electron windows, clipboard writes, or real Provider requests are made.
function createHarness() {
  let cursor = { x: 100, y: 100 };
  let appName = "Cursor";
  let appDetectionCount = 0;
  let online: boolean | undefined = true;
  let clipboardReads = 0;
  const handlers = new Map<string, (event: unknown, payload?: unknown) => void>();
  const states: PopoverStatePayload[] = [];
  const requests: Array<{
    body: { word: string; source_app: string; user_goal: string };
    signal: AbortSignal;
    resolve: (response: Response) => void;
    reject: (error: unknown) => void;
  }> = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  let bounds = { x: 116, y: 116, width: 296, height: 64 };
  const mainFrame = {};
  const window = {
    id: 7,
    visible: false,
    showCount: 0,
    options: {} as Record<string, unknown>,
    webContents: {
      mainFrame,
      on() {},
      send(channel: string, payload: PopoverStatePayload) {
        if (channel !== channels.state) return;
        states.push(payload);
        queueMicrotask(() => height(payload));
      },
    },
    setAlwaysOnTop() {}, setVisibleOnAllWorkspaces() {}, on() {},
    async loadFile() {
      handlers.get(channels.ready)?.(event());
    },
    getBounds: () => ({ ...bounds }),
    getContentBounds: () => ({ ...bounds }),
    setContentSize(width: number, height: number) { bounds = { ...bounds, width, height }; },
    setPosition(x: number, y: number) { bounds = { ...bounds, x, y }; },
    isVisible() { return this.visible; },
    showInactive() { this.visible = true; this.showCount++; },
    hide() { this.visible = false; },
  };
  const event = () => ({ sender: window.webContents, senderFrame: mainFrame });
  function height(payload: PopoverStatePayload) {
    handlers.get(channels.contentHeight)?.(event(), {
      requestId: payload.requestId, status: payload.status, height: 280,
    });
  }
  const electron = {
    app: {
      requestSingleInstanceLock: () => true,
      whenReady: () => new Promise<void>(() => undefined),
      on() {}, quit() {},
    },
    BrowserWindow: function (options: Record<string, unknown>) {
      window.options = options;
      return window;
    },
    ipcMain: { on: (channel: string, handler: (event: unknown, payload?: unknown) => void) => handlers.set(channel, handler) },
    clipboard: { readText: () => { clipboardReads++; return "ignored"; } },
    net: { isOnline: () => { if (online === undefined) throw new Error("unknown"); return online; } },
    screen: {
      getCursorScreenPoint: () => ({ ...cursor }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }),
    },
  };
  const exported: Record<string, any> = {};
  vm.runInNewContext(readFileSync(path.join(__dirname, "main.js"), "utf8") + `
    exports.detectWord = handleDetectedWord;
    exports.mouseDown = handleGlobalMouseDown;
    exports.state = () => ({ latestAIRequestId, dismissedPopoverRequestId, failedRequest });
    registerReactPopoverIpc();
  `, {
    exports: exported,
    require: (name: string) => {
      if (name === "electron") return electron;
      if (name === "node:child_process") return {
        execFile: (_path: string, _options: unknown, callback: (error: null, stdout: string) => void) => {
          appDetectionCount++;
          callback(null, appName);
        },
      };
      return require(name);
    },
    __dirname,
    process: { env: {}, argv: [], pid: 123, platform: "darwin" },
    console: { log() {}, error() {} },
    AbortController, Error, SyntaxError, TypeError,
    setTimeout: (callback: () => void, delay: number) => {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: (_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      requests.push({ body: JSON.parse(String(init.body)), signal: init.signal!, resolve, reject });
    }),
  });
  return {
    window, states, requests, timers,
    detect: (word: string): Promise<void> => exported.detectWord(word),
    retry: (value: unknown, overrideEvent?: unknown) => handlers.get(channels.retry)?.(overrideEvent ?? event(), value),
    state: () => exported.state(),
    dismiss: () => { cursor = { x: 1500, y: 900 }; exported.mouseDown(); },
    clickInside: () => { cursor = { x: bounds.x + 20, y: bounds.y + 20 }; exported.mouseDown(); },
    getBounds: () => ({ ...bounds }),
    setContext: (name: string, point: { x: number; y: number }) => { appName = name; cursor = point; },
    setOnline: (value: boolean | undefined) => { online = value; },
    counts: () => ({ appDetectionCount, clipboardReads }),
    latest: () => states.at(-1)!,
    height,
  };
}

async function flush() {
  for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function success(word: string) {
  return Response.json({ word, phonetic: "", translation: "释义", general_meaning: "含义", context_explanation: "语境", example: "Example" });
}

async function failFirst(h: ReturnType<typeof createHarness>, word = "component") {
  const pending = h.detect(word);
  await flush();
  h.requests.at(-1)!.resolve(Response.json({ error: "AI provider failed", code: "TIMEOUT" }, { status: 504 }));
  await pending;
  await flush();
  assert.equal(h.latest().status, "error");
  return h.latest().requestId;
}

test("Retry preserves exact context and original anchor, uses a new ID, rejects double clicks", async () => {
  const h = createHarness();
  const failedId = await failFirst(h);
  const originalBounds = h.getBounds();
  h.setContext("Google Chrome", { x: 900, y: 700 });
  h.retry(failedId);
  h.retry(failedId);
  assert.equal(h.state().latestAIRequestId, failedId + 1);
  await flush();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].body, h.requests[0].body);
  assert.deepEqual(h.getBounds(), originalBounds);
  assert.deepEqual(h.counts(), { appDetectionCount: 1, clipboardReads: 0 });
  h.requests[1].resolve(success("component"));
  await flush();
  assert.equal(h.latest().status, "result");
  assert.equal(h.latest().requestId, failedId + 1);
  assert.equal(h.window.options.focusable, false);
});

test("Retry rejects invalid sender/frame/payload and IPC received after dismissal", async () => {
  const h = createHarness();
  const failedId = await failFirst(h);
  for (const bad of [{ requestId: failedId, word: "injected" }, "1", NaN, 0, 1.5, -1]) h.retry(bad);
  h.retry(failedId, { sender: {}, senderFrame: {} });
  h.retry(failedId, { sender: h.window.webContents, senderFrame: {} });
  assert.equal(h.state().latestAIRequestId, failedId);
  h.clickInside();
  assert.equal(h.window.visible, true);
  h.dismiss();
  h.retry(failedId);
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.window.visible, false);
});

test("new clipboard copy aborts Retry; late Retry result and old height cannot overwrite it", async () => {
  const h = createHarness();
  const failedId = await failFirst(h);
  h.retry(failedId);
  await flush();
  const retryLoading = h.latest();
  h.setContext("Figma", { x: 400, y: 300 });
  const pending = h.detect("dependency");
  assert.equal(h.requests[1].signal.aborted, true);
  h.retry(failedId);
  await flush();
  h.requests[2].resolve(success("dependency"));
  await pending;
  await flush();
  const current = h.latest();
  h.requests[1].resolve(success("component")); // deliberately ignore abort
  await flush();
  assert.equal(h.latest(), current);
  assert.equal(current.currentApplication, "Figma");
  const shows = h.window.showCount;
  h.height(retryLoading);
  assert.equal(h.window.showCount, shows);
});

test("dismiss during Retry Loading suppresses late Result and late Error", async () => {
  for (const outcome of ["result", "error"] as const) {
    const h = createHarness();
    const failedId = await failFirst(h);
    h.retry(failedId);
    await flush();
    h.dismiss();
    h.requests[1].resolve(outcome === "result" ? success("component") :
      Response.json({ code: "TIMEOUT" }, { status: 504 }));
    await flush();
    assert.equal(h.latest().status, outcome);
    assert.equal(h.window.visible, false);
    h.retry(h.latest().requestId);
    assert.equal(h.requests.length, 2);
    const pending = h.detect("repository");
    await flush();
    assert.equal(h.window.visible, true);
    h.requests[2].resolve(success("repository"));
    await pending;
  }
});

test("five copy/dismiss cycles re-show and retain request-specific dismissal", async () => {
  const h = createHarness();
  for (const word of ["component", "dependency", "responsive", "repository", "architecture"]) {
    const pending = h.detect(word);
    await flush();
    assert.equal(h.window.visible, true);
    h.requests.at(-1)!.resolve(success(word));
    await pending;
    await flush();
    h.dismiss();
    assert.equal(h.window.visible, false);
    h.height(h.latest());
    assert.equal(h.window.visible, false);
  }
});

test("confirmed Offline uses real Retry; nonretryable errors cannot make another request", async () => {
  const h = createHarness();
  h.setOnline(false);
  const pending = h.detect("component");
  await flush();
  h.requests[0].resolve(Response.json({ code: "NETWORK_ERROR" }, { status: 503 }));
  await pending;
  await flush();
  assert.equal(h.latest().status, "offline");
  assert.equal(h.window.visible, true); // Offline height is accepted
  h.setOnline(true);
  await flush();
  assert.equal(h.requests.length, 1); // no recovery listener/automatic retry
  h.retry(h.latest().requestId);
  await flush();
  h.requests[1].resolve(Response.json({ code: "MISSING_API_KEY" }, { status: 503 }));
  await flush();
  const state = h.latest();
  assert.equal(state.status, "error");
  if (state.status === "error") assert.equal(state.failure.retryable, false);
  h.retry(state.requestId);
  await flush();
  assert.equal(h.requests.length, 2);
});

test("client deadline stays 10 seconds and is Error even when device offline", async () => {
  const h = createHarness();
  h.setOnline(false);
  const pending = h.detect("component");
  await flush();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 10_000);
  timer.callback();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].reject(new Error("aborted"));
  await pending;
  await flush();
  const state = h.latest();
  assert.equal(state.status, "error");
  if (state.status === "error") assert.equal(state.failure.code, "CLIENT_TIMEOUT");
  assert.equal(h.timers.size, 0);
});

test("five consecutive Retry failures keep the snapshot and issue one new ID each time", async () => {
  const h = createHarness();
  let failedId = await failFirst(h);
  const originalRequest = h.requests[0].body;
  for (let cycle = 0; cycle < 5; cycle++) {
    h.retry(failedId);
    await flush();
    assert.equal(h.latest().status, "loading");
    assert.equal(h.latest().requestId, failedId + 1);
    assert.deepEqual(h.requests.at(-1)!.body, originalRequest);
    h.requests.at(-1)!.resolve(Response.json({ code: "TIMEOUT" }, { status: 504 }));
    await flush();
    assert.equal(h.latest().status, "error");
    assert.equal(h.window.visible, true);
    failedId = h.latest().requestId;
  }
  assert.equal(h.requests.length, 6);
  assert.deepEqual(h.counts(), { appDetectionCount: 1, clipboardReads: 0 });
});

test("late rejected Retry cannot replace a newer successful clipboard request or its snapshot", async () => {
  const h = createHarness();
  h.retry(await failFirst(h));
  await flush();
  const pending = h.detect("responsive");
  await flush();
  h.requests[2].resolve(success("responsive"));
  await pending;
  await flush();
  const current = h.latest();
  h.requests[1].reject(new TypeError("old request failed"));
  await flush();
  assert.equal(h.latest(), current);
  assert.equal(h.state().failedRequest, null);
  assert.equal(h.requests[1].signal.aborted, true);
});

test("invalid successful payload and loopback refusal remain Error in the real main handler", async () => {
  for (const mode of ["json", "word", "refused"] as const) {
    const h = createHarness();
    h.setOnline(false);
    const pending = h.detect("component");
    await flush();
    if (mode === "refused") {
      h.requests[0].reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
    } else {
      h.requests[0].resolve(mode === "json" ? new Response("invalid json") : success("wrongword"));
    }
    await pending;
    await flush();
    const state = h.latest();
    assert.equal(state.status, "error");
    if (state.status === "error") {
      assert.equal(state.failure.code, mode === "refused" ? "BACKEND_UNAVAILABLE" : "INVALID_RESPONSE");
      assert.equal(state.failure.retryable, true);
    }
  }
});
