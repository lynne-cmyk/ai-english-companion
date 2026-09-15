import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  net,
  safeStorage,
  screen,
  shell,
  systemPreferences,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import {
  classifyFailure,
  type FailureInfo,
  type RequestSnapshot,
} from "./aiRecovery";
import type { ExplanationService } from "./explanation/contracts";
import { HttpExplanationService } from "./explanation/httpExplanationService";
import {
  POPOVER_IPC_CHANNELS,
  type ExplanationResult,
  type PopoverContentHeightPayload,
  type PopoverStatePayload,
} from "./popoverIpc";
import {
  resolveNativeHelperPath,
  resolveNativeHelperWorkingDirectory,
} from "./nativeHelperPaths";
import { SelectionActionController } from "./selection/SelectionActionController";
import { isValidSelectionBounds } from "./selection/position";
import type { SelectionSnapshot } from "./selection/selectionSession";
import {
  PERMISSION_STATE_CHANNELS,
  type PermissionStateSnapshot,
} from "./permissions/contracts";
import { PermissionStateService } from "./permissions/permissionState";
import { PermissionSetupWindowManager } from "./permissions/permissionSetupWindow";
import { createMenuBarIcon } from "./permissions/menuBarIcon";
import {
  menuStatusLabel,
  shouldAutoOpenPermissionSetup,
  shouldCreateTechnicalSpikeWindow,
} from "./permissions/setupPresentation";
import {
  API_KEY_SETUP_CHANNELS,
  type ApiKeySetupErrorCode,
  type ApiKeySetupResult,
  type ApiKeySetupState,
} from "./secrets/contracts";
import { ApiKeySetupWindowManager } from "./secrets/apiKeySetupWindow";
import {
  createDeepSeekSecretStore,
  type SafeStorageLike,
} from "./secrets/safeStorageCipher";
import {
  SecretStoreError,
  type SecretStore,
} from "./secrets/secretStore";

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let floatingWindowLoadPromise: Promise<void> | null = null;
let clipboardTimer: NodeJS.Timeout | null = null;
let activeAIRequestController: AbortController | null = null;
let latestAIRequestId = 0;
let dismissedPopoverRequestId: number | null = null;
let failedRequest: {
  requestId: number;
  snapshot: RequestSnapshot;
  failure: FailureInfo;
} | null = null;
let reactPopoverReady = false;
let pendingReactPopoverState: PopoverStatePayload | null = null;
let floatingWindowAnchor: { x: number; y: number } | null = null;
let globalMouseMonitorProcess: ChildProcess | null = null;
let globalMouseMonitorOutput = "";
let selectionActionController: SelectionActionController | null = null;
let permissionStateService: PermissionStateService | null = null;
let unsubscribePermissionState: (() => void) | null = null;
let permissionActivationTimer: NodeJS.Timeout | null = null;
const permissionSetupWindows =
  new PermissionSetupWindowManager<BrowserWindow>();
const apiKeySetupWindows = new ApiKeySetupWindowManager<BrowserWindow>();
let permissionSetupRendererReady = false;
let permissionSetupShowRequested = false;
let permissionSetupReadyHideTimer: NodeJS.Timeout | null = null;
let inputMonitoringRestartRequired = false;
let menuBarTray: Tray | null = null;
let apiKeyStore: SecretStore | null = null;
let apiKeySetupRendererReady = false;
let apiKeySetupShowRequested = false;
let applicationIsQuitting = false;
const isSmokeTest = process.argv.includes("--smoke-test");
const CLIPBOARD_POLL_INTERVAL_MS = 500;
const LEGACY_FLOATING_WINDOW_WIDTH = 360;
const LEGACY_FLOATING_WINDOW_HEIGHT = 300;
const REACT_FLOATING_WINDOW_WIDTH = 296;
const REACT_FLOATING_WINDOW_INITIAL_HEIGHT = 64;
const REACT_FLOATING_WINDOW_MAX_HEIGHT = 368;
const FLOATING_WINDOW_OFFSET = 16;
const AI_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_USER_GOAL = "learn English while working";
const POPOVER_RENDERER =
  process.env.AI_ENGLISH_POPOVER_RENDERER === "legacy" ? "legacy" : "react";

function nativeHelperContext() {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    developmentRoot: path.resolve(__dirname, ".."),
  };
}

function nativeHelperPath(
  helper: Parameters<typeof resolveNativeHelperPath>[0],
) {
  return resolveNativeHelperPath(helper, nativeHelperContext());
}

const explanationService: ExplanationService = new HttpExplanationService({
  fetchImplementation: fetch,
});

type FloatingWindowState =
  | {
      status: "loading";
      word: string;
      currentApplication: string;
    }
  | {
      status: "result";
      result: ExplanationResult;
      currentApplication: string;
    }
  | {
      status: "error" | "offline";
      word: string;
      currentApplication: string;
      failure: FailureInfo;
    };

const floatingWindowHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        background: #ffffff;
      }

      body {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        margin: 0;
        border: 1px solid #d1d5db;
        box-sizing: border-box;
        padding: 14px 16px;
        overflow: hidden;
      }

      #word {
        overflow: hidden;
        font-size: 20px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #loading,
      #error {
        margin-top: 18px;
        color: #6b7280;
        font-size: 14px;
      }

      #retry {
        margin-top: 8px;
        color: #2563eb;
      }

      #result {
        margin-top: 8px;
      }

      #phonetic {
        color: #6b7280;
        font-size: 13px;
      }

      #translation {
        margin-top: 4px;
        font-size: 17px;
        font-weight: 600;
      }

      #context-explanation,
      #example {
        margin-top: 12px;
        font-size: 13px;
        line-height: 1.45;
      }

      #example {
        color: #4b5563;
        font-style: italic;
      }

      #current-app-label {
        margin-top: auto;
        color: #6b7280;
        font-size: 12px;
      }

      #current-app {
        margin-top: 2px;
        overflow: hidden;
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      [hidden] {
        display: none !important;
      }
    </style>
  </head>
  <body>
    <div id="word"></div>
    <div id="loading" hidden>AI is thinking...</div>
    <div id="result" hidden>
      <div id="phonetic"></div>
      <div id="translation"></div>
      <div id="context-explanation"></div>
      <div id="example"></div>
    </div>
    <div id="error" hidden>
      <div>Unable to connect to AI.</div>
      <div id="retry">Try again</div>
    </div>
    <div id="current-app-label">Current App:</div>
    <div id="current-app"></div>
  </body>
</html>`;

function isSingleEnglishWord(value: string) {
  return /^[A-Za-z]+$/.test(value);
}

function selectionAnchor(snapshot: SelectionSnapshot) {
  if (snapshot.bounds) {
    const boundsCenter = {
      x: snapshot.bounds.x + snapshot.bounds.width / 2,
      y: snapshot.bounds.y + snapshot.bounds.height / 2,
    };
    const { workArea } = screen.getDisplayNearestPoint(boundsCenter);
    if (isValidSelectionBounds(snapshot.bounds, workArea)) {
      return {
        x: snapshot.bounds.x + snapshot.bounds.width,
        y: snapshot.bounds.y + snapshot.bounds.height / 2,
      };
    }
  }

  return { ...snapshot.mousePosition };
}

function getFrontmostApplicationName() {
  const helperPath = nativeHelperPath("frontmostApp");

  return new Promise<string>((resolve) => {
    execFile(helperPath, { timeout: 2_000 }, (error, stdout) => {
      if (error) {
        console.error("[current-app] Detection failed:", error.message);
        resolve("Unknown");
        return;
      }

      const applicationName = stdout.trim() || "Unknown";
      console.log(`[current-app] Detected: ${applicationName}`);
      resolve(applicationName);
    });
  });
}

function isPointInsideFloatingWindow(point: { x: number; y: number }) {
  if (floatingWindow === null) {
    return false;
  }

  const bounds = floatingWindow.getBounds();
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function handleGlobalMouseDown() {
  if (floatingWindow === null || !floatingWindow.isVisible()) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const bounds = floatingWindow.getBounds();
  const isInside = isPointInsideFloatingWindow(cursorPoint);

  console.log(
    `[floating] Mouse down received: point=${cursorPoint.x},${cursorPoint.y} bounds=${bounds.x},${bounds.y},${bounds.width},${bounds.height} inside=${String(isInside)}`,
  );

  if (!isInside) {
    dismissedPopoverRequestId = latestAIRequestId;
    floatingWindow.hide();
    console.log(
      `[floating] hide() called for request ${latestAIRequestId}; visible=${String(floatingWindow.isVisible())}.`,
    );
  }
}

function startGlobalMouseMonitor() {
  if (process.platform !== "darwin" || globalMouseMonitorProcess !== null) {
    return;
  }

  const helperPath = nativeHelperPath("globalMouseMonitor");
  let monitorProcess: ChildProcess;

  try {
    monitorProcess = spawn(helperPath, [], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[floating] Failed to start mouse monitor: ${message}`);
    return;
  }

  globalMouseMonitorProcess = monitorProcess;

  monitorProcess.stdout?.on("data", (chunk: Buffer) => {
    globalMouseMonitorOutput += chunk.toString("utf8");

    let newlineIndex = globalMouseMonitorOutput.indexOf("\n");

    while (newlineIndex !== -1) {
      const eventName = globalMouseMonitorOutput.slice(0, newlineIndex).trim();
      globalMouseMonitorOutput = globalMouseMonitorOutput.slice(
        newlineIndex + 1,
      );

      if (eventName === "mouse-down") {
        handleGlobalMouseDown();
      } else if (eventName === "ready") {
        console.log("[floating] Global mouse monitor ready.");
      }

      newlineIndex = globalMouseMonitorOutput.indexOf("\n");
    }
  });

  monitorProcess.stderr?.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();

    if (message !== "") {
      console.error(`[floating] Mouse monitor: ${message}`);
    }
  });

  monitorProcess.on("error", (error) => {
    if (globalMouseMonitorProcess === monitorProcess) {
      globalMouseMonitorProcess = null;
    }

    console.error("[floating] Failed to start mouse monitor:", error.message);
  });

  monitorProcess.on("exit", (code, signal) => {
    if (globalMouseMonitorProcess === monitorProcess) {
      globalMouseMonitorProcess = null;
    }

    globalMouseMonitorOutput = "";

    if (!applicationIsQuitting && code !== 0) {
      console.error(
        `[floating] Mouse monitor exited (code=${String(code)}, signal=${String(signal)}).`,
      );
    }
  });

  console.log("[floating] Global mouse monitor started.");
}

function startSelectionActionController() {
  if (process.platform !== "darwin" || selectionActionController !== null) {
    return;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const selectionProbePath = nativeHelperPath("selectionProbe");
  const controller = new SelectionActionController({
    repoRoot,
    rendererPath: path.join(repoRoot, "dist/selection-action.html"),
    probePath: selectionProbePath,
    probeWorkingDirectory: resolveNativeHelperWorkingDirectory(
      nativeHelperContext(),
    ),
    preloadPath: path.join(__dirname, "selection/preload.js"),
    onProbePermissionStateChange(state) {
      permissionStateService?.acceptProbeEvidence(state);
    },
    onAcceptedSelection(snapshot) {
      handleAcceptedSelection(snapshot);
    },
  });

  try {
    controller.start();
    selectionActionController = controller;
    console.log("[selection-action] Production controller started.");
  } catch (error) {
    controller.stop();
    permissionStateService?.markHelperUnavailable("controller_start_failed");
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[selection-action] Production controller unavailable: ${message}`);
  }
}

function isPermissionSetupSender(event: IpcMainInvokeEvent) {
  const permissionWindow = permissionSetupWindows.current;
  return (
    permissionWindow !== null &&
    !permissionWindow.isDestroyed() &&
    event.sender === permissionWindow.webContents &&
    event.senderFrame === permissionWindow.webContents.mainFrame
  );
}

function sendPermissionStateToSetupWindow() {
  const permissionWindow = permissionSetupWindows.current;
  if (
    permissionStateService === null ||
    permissionWindow === null ||
    permissionWindow.isDestroyed() ||
    permissionWindow.webContents.isDestroyed()
  ) {
    return;
  }
  permissionWindow.webContents.send(
    PERMISSION_STATE_CHANNELS.changed,
    permissionStateService.current,
  );
}

function clearPermissionSetupReadyHideTimer() {
  if (permissionSetupReadyHideTimer === null) return;
  clearTimeout(permissionSetupReadyHideTimer);
  permissionSetupReadyHideTimer = null;
}

function schedulePermissionSetupReadyHide() {
  clearPermissionSetupReadyHideTimer();
  permissionSetupReadyHideTimer = setTimeout(() => {
    permissionSetupReadyHideTimer = null;
    permissionSetupShowRequested = false;
    permissionSetupWindows.hide();
    permissionSetupWindows.clearOpenContext();
  }, 1_300);
}

function createPermissionSetupWindow() {
  const permissionWindow = new BrowserWindow({
    width: 416,
    height: 372,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: "AI English Companion — 权限设置",
    backgroundColor: "#FFFFFF",
    webPreferences: {
      preload: path.join(__dirname, "permissions/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  permissionSetupRendererReady = false;
  permissionWindow.webContents.on(
    "did-fail-load",
    (_event, code, description) => {
      console.error(
        `[permission-setup] Page failed to load (${code}): ${description}`,
      );
    },
  );
  permissionWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[permission-setup] Renderer stopped: ${details.reason}`);
  });
  permissionWindow.webContents.once("did-finish-load", () => {
    permissionSetupRendererReady = true;
    sendPermissionStateToSetupWindow();
  });
  permissionWindow.once("ready-to-show", () => {
    if (
      permissionSetupShowRequested &&
      permissionSetupWindows.current === permissionWindow
    ) {
      permissionSetupWindows.show();
      if (permissionSetupWindows.takeReadyAutoHideRequest()) {
        schedulePermissionSetupReadyHide();
      }
    }
  });
  permissionWindow.on("close", (event) => {
    if (applicationIsQuitting) return;
    event.preventDefault();
    permissionSetupShowRequested = false;
    clearPermissionSetupReadyHideTimer();
    permissionSetupWindows.hide();
    permissionSetupWindows.clearOpenContext();
  });
  permissionWindow.on("closed", () => {
    permissionSetupWindows.release(permissionWindow);
    permissionSetupRendererReady = false;
    permissionSetupShowRequested = false;
  });

  void permissionWindow.loadFile(
    path.join(__dirname, "../dist/permission-setup.html"),
  );
  return permissionWindow;
}

function showPermissionSetupWindow(reason: "automatic" | "manual") {
  if (reason === "manual") clearPermissionSetupReadyHideTimer();
  permissionSetupWindows.requestOpen(reason);
  permissionSetupShowRequested = true;
  const permissionWindow = permissionSetupWindows.ensure(
    createPermissionSetupWindow,
  );
  if (permissionSetupRendererReady) {
    permissionSetupWindows.show();
    sendPermissionStateToSetupWindow();
  }
  if (
    permissionSetupRendererReady &&
    permissionSetupWindows.takeReadyAutoHideRequest()
  ) {
    schedulePermissionSetupReadyHide();
  }
  return permissionWindow;
}

function isApiKeySetupSender(event: IpcMainInvokeEvent) {
  const setupWindow = apiKeySetupWindows.current;
  return (
    setupWindow !== null &&
    !setupWindow.isDestroyed() &&
    event.sender === setupWindow.webContents &&
    event.senderFrame === setupWindow.webContents.mainFrame
  );
}

function publicApiKeyError(error: unknown): ApiKeySetupErrorCode {
  if (!(error instanceof SecretStoreError)) return "storage_unavailable";
  switch (error.code) {
    case "INVALID_API_KEY":
      return "invalid_api_key";
    case "ENCRYPTION_UNAVAILABLE":
    case "ENCRYPTION_FAILED":
      return "encryption_unavailable";
    case "CORRUPTED_SECRET":
    case "DECRYPTION_FAILED":
      return "stored_key_unreadable";
    case "STORAGE_READ_FAILED":
    case "STORAGE_WRITE_FAILED":
    case "STORAGE_DELETE_FAILED":
      return "storage_unavailable";
  }
}

function apiKeyFailure(
  operation: "read" | "save" | "delete",
  error: unknown,
): ApiKeySetupState {
  const errorCode = publicApiKeyError(error);
  console.error(`[api-key-setup] ${operation} failed category=${errorCode}`);
  return { status: "error", configured: false, error: errorCode };
}

async function readApiKeySetupState(): Promise<ApiKeySetupState> {
  if (apiKeyStore === null) {
    return {
      status: "error",
      configured: false,
      error: "storage_unavailable",
    };
  }
  try {
    return { status: "ready", configured: await apiKeyStore.isConfigured() };
  } catch (error) {
    return apiKeyFailure("read", error);
  }
}

function createApiKeySetupWindow() {
  const setupWindow = new BrowserWindow({
    width: 416,
    height: 300,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: "AI English Companion — AI 服务设置",
    backgroundColor: "#FFFFFF",
    webPreferences: {
      preload: path.join(__dirname, "secrets/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  apiKeySetupRendererReady = false;
  setupWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(
      `[api-key-setup] Page failed to load (${code}): ${description}`,
    );
  });
  setupWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[api-key-setup] Renderer stopped: ${details.reason}`);
  });
  setupWindow.webContents.once("did-finish-load", () => {
    apiKeySetupRendererReady = true;
  });
  setupWindow.once("ready-to-show", () => {
    if (
      apiKeySetupShowRequested &&
      apiKeySetupWindows.current === setupWindow
    ) {
      apiKeySetupWindows.show();
    }
  });
  setupWindow.on("close", (event) => {
    if (applicationIsQuitting) return;
    event.preventDefault();
    apiKeySetupShowRequested = false;
    apiKeySetupWindows.hide();
  });
  setupWindow.on("closed", () => {
    apiKeySetupWindows.release(setupWindow);
    apiKeySetupRendererReady = false;
    apiKeySetupShowRequested = false;
  });

  void setupWindow.loadFile(
    path.join(__dirname, "../dist/api-key-setup.html"),
  );
  return setupWindow;
}

function showApiKeySetupWindow() {
  apiKeySetupShowRequested = true;
  const setupWindow = apiKeySetupWindows.ensure(createApiKeySetupWindow);
  if (apiKeySetupRendererReady) apiKeySetupWindows.show();
  return setupWindow;
}

function startApiKeySetupInfrastructure() {
  if (apiKeyStore !== null) return;
  apiKeyStore = createDeepSeekSecretStore(
    app.getPath("userData"),
    safeStorage as SafeStorageLike,
  );

  ipcMain.handle(API_KEY_SETUP_CHANNELS.getState, async (event) => {
    if (!isApiKeySetupSender(event)) {
      throw new Error("Rejected API Key setup sender");
    }
    return readApiKeySetupState();
  });
  ipcMain.handle(
    API_KEY_SETUP_CHANNELS.setApiKey,
    async (event, apiKey: unknown): Promise<ApiKeySetupResult> => {
      if (!isApiKeySetupSender(event)) {
        throw new Error("Rejected API Key setup sender");
      }
      if (apiKeyStore === null || typeof apiKey !== "string") {
        return {
          ok: false,
          state: {
            status: "error",
            configured: false,
            error: typeof apiKey === "string"
              ? "storage_unavailable"
              : "invalid_api_key",
          },
        };
      }
      try {
        await apiKeyStore.setApiKey(apiKey);
        return { ok: true, state: { status: "ready", configured: true } };
      } catch (error) {
        return { ok: false, state: apiKeyFailure("save", error) };
      }
    },
  );
  ipcMain.handle(
    API_KEY_SETUP_CHANNELS.deleteApiKey,
    async (event): Promise<ApiKeySetupResult> => {
      if (!isApiKeySetupSender(event)) {
        throw new Error("Rejected API Key setup sender");
      }
      if (apiKeyStore === null) {
        return {
          ok: false,
          state: {
            status: "error",
            configured: false,
            error: "storage_unavailable",
          },
        };
      }
      try {
        await apiKeyStore.deleteApiKey();
        return { ok: true, state: { status: "ready", configured: false } };
      } catch (error) {
        return { ok: false, state: apiKeyFailure("delete", error) };
      }
    },
  );
}

function stopApiKeySetupInfrastructure() {
  if (apiKeyStore === null) return;
  ipcMain.removeHandler(API_KEY_SETUP_CHANNELS.getState);
  ipcMain.removeHandler(API_KEY_SETUP_CHANNELS.setApiKey);
  ipcMain.removeHandler(API_KEY_SETUP_CHANNELS.deleteApiKey);
  apiKeyStore = null;
}

function updateMenuBar(status = permissionStateService?.current.status ?? "checking") {
  if (menuBarTray === null || menuBarTray.isDestroyed()) return;
  menuBarTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "AI English Companion", enabled: false },
      { label: menuStatusLabel(status), enabled: false },
      { type: "separator" },
      {
        label: "权限设置…",
        click: () => {
          showPermissionSetupWindow("manual");
        },
      },
      {
        label: "AI 服务设置…",
        click: () => {
          showApiKeySetupWindow();
        },
      },
      { type: "separator" },
      {
        label: "退出 AI English Companion",
        click: () => {
          applicationIsQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function startMenuBar() {
  if (menuBarTray !== null && !menuBarTray.isDestroyed()) return;
  console.log("[tray] creation attempted");
  menuBarTray = new Tray(createMenuBarIcon());
  console.log("[tray] created and retained");
  menuBarTray.setToolTip("AI English Companion");
  updateMenuBar("checking");
  console.log("[tray] context menu attached");
}

function handlePermissionStateForProductShell(state: PermissionStateSnapshot) {
  permissionSetupWindows.observePermissionStatus(state.status);
  updateMenuBar(
    inputMonitoringRestartRequired ? "needs_input_monitoring" : state.status,
  );
  sendPermissionStateToSetupWindow();

  if (state.status === "checking" || isSmokeTest) return;
  if (inputMonitoringRestartRequired) return;
  if (state.status === "ready") {
    if (
      permissionSetupRendererReady &&
      permissionSetupWindows.current?.isVisible() &&
      permissionSetupWindows.takeReadyAutoHideRequest()
    ) {
      schedulePermissionSetupReadyHide();
    }
    return;
  }

  clearPermissionSetupReadyHideTimer();
  if (shouldAutoOpenPermissionSetup(state.status)) {
    showPermissionSetupWindow("automatic");
  }
}

const SYSTEM_SETTINGS_URLS = {
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  inputMonitoring:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  privacy: "x-apple.systempreferences:com.apple.preference.security",
} as const;

async function openFixedSystemSettings(
  target: "accessibility" | "inputMonitoring",
) {
  try {
    await shell.openExternal(SYSTEM_SETTINGS_URLS[target]);
  } catch {
    await shell.openExternal(SYSTEM_SETTINGS_URLS.privacy);
  }
}

function scheduleApplicationRelaunch() {
  setImmediate(() => {
    if (applicationIsQuitting) return;
    applicationIsQuitting = true;
    app.relaunch();
    app.quit();
  });
}

function startPermissionStateInfrastructure() {
  if (permissionStateService !== null) return;

  permissionStateService = new PermissionStateService({
    checkMainAccessibility: () =>
      process.platform === "darwin"
        ? systemPreferences.isTrustedAccessibilityClient(false)
        : true,
    restartProbe: () =>
      selectionActionController?.restartProbeForPermissionRecheck() ?? null,
    log: (message) => console.log(message),
  });
  unsubscribePermissionState = permissionStateService.subscribe((state) => {
    handlePermissionStateForProductShell(state);
  });

  ipcMain.handle(PERMISSION_STATE_CHANNELS.getState, (event) => {
    if (!isPermissionSetupSender(event)) {
      throw new Error("Rejected permission state sender");
    }
    if (permissionStateService === null) {
      throw new Error("Permission state service unavailable");
    }
    return permissionStateService.current;
  });
  ipcMain.handle(PERMISSION_STATE_CHANNELS.recheck, async (event) => {
    if (!isPermissionSetupSender(event)) {
      throw new Error("Rejected permission recheck sender");
    }
    if (permissionStateService === null) {
      throw new Error("Permission state service unavailable");
    }
    return permissionStateService.recheck();
  });
  ipcMain.handle(
    PERMISSION_STATE_CHANNELS.openAccessibilitySettings,
    async (event) => {
      if (!isPermissionSetupSender(event)) {
        throw new Error("Rejected Accessibility settings sender");
      }
      await openFixedSystemSettings("accessibility");
    },
  );
  ipcMain.handle(
    PERMISSION_STATE_CHANNELS.openInputMonitoringSettings,
    async (event) => {
      if (!isPermissionSetupSender(event)) {
        throw new Error("Rejected Input Monitoring settings sender");
      }
      inputMonitoringRestartRequired = true;
      updateMenuBar("needs_input_monitoring");
      try {
        await openFixedSystemSettings("inputMonitoring");
      } catch (error) {
        inputMonitoringRestartRequired = false;
        updateMenuBar(permissionStateService?.current.status);
        throw error;
      }
    },
  );
  ipcMain.handle(PERMISSION_STATE_CHANNELS.relaunch, (event) => {
    if (!isPermissionSetupSender(event)) {
      throw new Error("Rejected application relaunch sender");
    }
    scheduleApplicationRelaunch();
  });

  handlePermissionStateForProductShell(permissionStateService.initialize());
}

function schedulePermissionRecheck() {
  if (permissionActivationTimer !== null || applicationIsQuitting) return;
  permissionActivationTimer = setTimeout(() => {
    permissionActivationTimer = null;
    void permissionStateService?.recheck().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[permission-state] recheck failed: ${message}`);
    });
  }, 300);
}

function stopPermissionStateInfrastructure() {
  if (permissionActivationTimer !== null) {
    clearTimeout(permissionActivationTimer);
    permissionActivationTimer = null;
  }
  if (permissionStateService === null) return;
  ipcMain.removeHandler(PERMISSION_STATE_CHANNELS.getState);
  ipcMain.removeHandler(PERMISSION_STATE_CHANNELS.recheck);
  ipcMain.removeHandler(PERMISSION_STATE_CHANNELS.openAccessibilitySettings);
  ipcMain.removeHandler(PERMISSION_STATE_CHANNELS.openInputMonitoringSettings);
  ipcMain.removeHandler(PERMISSION_STATE_CHANNELS.relaunch);
  unsubscribePermissionState?.();
  unsubscribePermissionState = null;
  permissionStateService = null;
}

function moveFloatingWindowNearCursor() {
  if (floatingWindow === null) {
    return;
  }

  const cursorPoint = floatingWindowAnchor ?? screen.getCursorScreenPoint();
  const { width: windowWidth, height: windowHeight } =
    floatingWindow.getContentBounds();
  const { workArea } = screen.getDisplayNearestPoint(cursorPoint);
  const maximumX = workArea.x + workArea.width - windowWidth;
  const maximumY = workArea.y + workArea.height - windowHeight;
  const preferredX = cursorPoint.x + FLOATING_WINDOW_OFFSET;
  const preferredY = cursorPoint.y + FLOATING_WINDOW_OFFSET;
  const fallbackX = cursorPoint.x - windowWidth - FLOATING_WINDOW_OFFSET;
  const fallbackY = cursorPoint.y - windowHeight - FLOATING_WINDOW_OFFSET;
  const x = Math.min(
    Math.max(preferredX <= maximumX ? preferredX : fallbackX, workArea.x),
    maximumX,
  );
  const y = Math.min(
    Math.max(preferredY <= maximumY ? preferredY : fallbackY, workArea.y),
    maximumY,
  );

  floatingWindow.setPosition(Math.round(x), Math.round(y), false);
}

async function ensureLegacyFloatingWindow() {
  if (floatingWindow === null) {
    floatingWindow = new BrowserWindow({
      width: LEGACY_FLOATING_WINDOW_WIDTH,
      height: LEGACY_FLOATING_WINDOW_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    floatingWindow.setAlwaysOnTop(true, "floating");
    floatingWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });

    floatingWindow.on("closed", () => {
      floatingWindow = null;
      floatingWindowLoadPromise = null;
      floatingWindowAnchor = null;
    });

    floatingWindowLoadPromise = floatingWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(floatingWindowHtml)}`,
    );
    await floatingWindowLoadPromise;
    console.log("[floating] Legacy window created.");
  } else if (floatingWindowLoadPromise !== null) {
    await floatingWindowLoadPromise;
  }

  if (floatingWindow === null) {
    throw new Error("Floating window was closed before it finished loading");
  }

  return floatingWindow;
}

async function ensureReactFloatingWindow() {
  if (floatingWindow === null) {
    floatingWindow = new BrowserWindow({
      width: REACT_FLOATING_WINDOW_WIDTH,
      height: REACT_FLOATING_WINDOW_INITIAL_HEIGHT,
      maxWidth: REACT_FLOATING_WINDOW_WIDTH,
      maxHeight: REACT_FLOATING_WINDOW_MAX_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      acceptFirstMouse: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    floatingWindow.setAlwaysOnTop(true, "floating");
    floatingWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });

    floatingWindow.webContents.on(
      "did-fail-load",
      (_event, code, description) => {
        console.error(
          `[floating] React renderer failed to load (${code}): ${description}`,
        );
      },
    );

    floatingWindow.on("closed", () => {
      floatingWindow = null;
      floatingWindowLoadPromise = null;
      reactPopoverReady = false;
      pendingReactPopoverState = null;
      floatingWindowAnchor = null;
    });

    floatingWindowLoadPromise = floatingWindow.loadFile(
      path.join(__dirname, "../dist/popover-window.html"),
    );
    await floatingWindowLoadPromise;
    console.log("[floating] React window created and waiting for content size.");
  } else if (floatingWindowLoadPromise !== null) {
    await floatingWindowLoadPromise;
  }

  if (floatingWindow === null) {
    throw new Error("Floating window was closed before it finished loading");
  }

  return floatingWindow;
}

async function showLegacyFloatingState(
  state: FloatingWindowState,
  requestId: number,
) {
  const window = await ensureLegacyFloatingWindow();

  if (requestId !== latestAIRequestId) {
    return;
  }

  await window.webContents.executeJavaScript(`(() => {
    const state = ${JSON.stringify(state)};
    const requestId = ${requestId};
    const previousRequestId = Number(document.body.dataset.requestId ?? "0");

    if (requestId < previousRequestId) {
      return;
    }

    document.body.dataset.requestId = String(requestId);
    const word = state.status === "result" ? state.result.word : state.word;
    document.getElementById("word").textContent = word;
    document.getElementById("current-app").textContent = state.currentApplication;
    document.getElementById("loading").hidden = state.status !== "loading";
    document.getElementById("result").hidden = state.status !== "result";
    document.getElementById("error").hidden = state.status !== "error";

    if (state.status === "result") {
      document.getElementById("phonetic").textContent = state.result.phonetic;
      document.getElementById("translation").textContent = state.result.translation;
      document.getElementById("context-explanation").textContent = state.result.context_explanation;
      document.getElementById("example").textContent = state.result.example;
    }
  })()`);

  if (requestId !== latestAIRequestId) {
    return;
  }

  if (dismissedPopoverRequestId === requestId) {
    return;
  }

  moveFloatingWindowNearCursor();
  window.showInactive();
}

async function showReactFloatingState(
  state: FloatingWindowState,
  requestId: number,
) {
  const window = await ensureReactFloatingWindow();

  if (requestId !== latestAIRequestId) {
    return;
  }

  const payload: PopoverStatePayload = { ...state, requestId };
  pendingReactPopoverState = payload;

  if (reactPopoverReady) {
    window.webContents.send(POPOVER_IPC_CHANNELS.state, payload);
  }
}

async function showFloatingState(
  state: FloatingWindowState,
  requestId: number,
) {
  if (POPOVER_RENDERER === "legacy") {
    // Keep the legacy HTML unchanged; only React has the Offline/Retry UI.
    await showLegacyFloatingState(
      state.status === "offline" ? { ...state, status: "error" } : state,
      requestId,
    );
    return;
  }

  await showReactFloatingState(state, requestId);
}

function isPopoverContentHeightPayload(
  value: unknown,
): value is PopoverContentHeightPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    Number.isInteger(payload.requestId) &&
    typeof payload.height === "number" &&
    Number.isFinite(payload.height) &&
    (payload.status === "loading" ||
      payload.status === "result" ||
      payload.status === "error" ||
      payload.status === "offline")
  );
}

function registerReactPopoverIpc() {
  ipcMain.on(POPOVER_IPC_CHANNELS.retry, (event, failedRequestId: unknown) => {
    if (
      applicationIsQuitting ||
      floatingWindow === null ||
      POPOVER_RENDERER !== "react" ||
      event.sender !== floatingWindow.webContents ||
      event.senderFrame !== floatingWindow.webContents.mainFrame ||
      !floatingWindow.isVisible() ||
      typeof failedRequestId !== "number" ||
      !Number.isSafeInteger(failedRequestId) ||
      failedRequestId <= 0 ||
      failedRequestId !== latestAIRequestId ||
      dismissedPopoverRequestId === failedRequestId ||
      failedRequest?.requestId !== failedRequestId ||
      !failedRequest.failure.retryable ||
      pendingReactPopoverState?.requestId !== failedRequestId ||
      (pendingReactPopoverState.status !== "error" &&
        pendingReactPopoverState.status !== "offline")
    ) {
      return;
    }

    const snapshot = failedRequest.snapshot;
    // The shared entry allocates a new ID synchronously, invalidating this Retry.
    void startTranslationRequest(snapshot).completion;
  });

  ipcMain.on(POPOVER_IPC_CHANNELS.ready, (event) => {
    if (
      floatingWindow === null ||
      event.sender !== floatingWindow.webContents ||
      POPOVER_RENDERER !== "react"
    ) {
      return;
    }

    reactPopoverReady = true;

    if (
      pendingReactPopoverState !== null &&
      pendingReactPopoverState.requestId === latestAIRequestId
    ) {
      event.sender.send(
        POPOVER_IPC_CHANNELS.state,
        pendingReactPopoverState,
      );
    }
  });

  ipcMain.on(
    POPOVER_IPC_CHANNELS.contentHeight,
    (event, payload: unknown) => {
      const candidate =
        typeof payload === "object" && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;

      if (
        floatingWindow === null ||
        event.sender !== floatingWindow.webContents ||
        POPOVER_RENDERER !== "react" ||
        !isPopoverContentHeightPayload(payload) ||
        payload.requestId !== latestAIRequestId ||
        pendingReactPopoverState?.requestId !== payload.requestId ||
        pendingReactPopoverState.status !== payload.status
      ) {
        console.log(
          `[floating] Height report rejected request=${String(candidate?.requestId)} status=${String(candidate?.status)} latest=${latestAIRequestId} pending=${String(pendingReactPopoverState?.requestId)}:${String(pendingReactPopoverState?.status)} dismissed=${String(dismissedPopoverRequestId)}.`,
        );
        return;
      }

      const nextHeight = Math.min(
        Math.max(Math.ceil(payload.height), 1),
        REACT_FLOATING_WINDOW_MAX_HEIGHT,
      );
      const currentBounds = floatingWindow.getContentBounds();

      console.log(
        `[floating] Height report accepted request=${payload.requestId} status=${payload.status} height=${nextHeight} dismissed=${String(dismissedPopoverRequestId)}.`,
      );

      if (
        currentBounds.width !== REACT_FLOATING_WINDOW_WIDTH ||
        currentBounds.height !== nextHeight
      ) {
        floatingWindow.setContentSize(
          REACT_FLOATING_WINDOW_WIDTH,
          nextHeight,
          false,
        );
      }

      if (dismissedPopoverRequestId === payload.requestId) {
        console.log(
          `[floating] Request ${payload.requestId} remains hidden after state=${payload.status}.`,
        );
        return;
      }

      moveFloatingWindowNearCursor();
      const wasVisible = floatingWindow.isVisible();
      floatingWindow.showInactive();
      console.log(
        `[floating] showInactive() request=${payload.requestId} window=${floatingWindow.id} visibleBefore=${String(wasVisible)} visibleAfter=${String(floatingWindow.isVisible())}.`,
      );
    },
  );
}

function beginRequest(word: string, anchor: Readonly<{ x: number; y: number }>) {
  const requestId = ++latestAIRequestId;

  console.log(
    `[floating] Request started id=${requestId} word=${word} dismissedBefore=${String(dismissedPopoverRequestId)} visibleBeforeLoading=${String(floatingWindow?.isVisible() ?? false)}.`,
  );
  dismissedPopoverRequestId = null;
  failedRequest = null;
  console.log(
    `[floating] Request reset id=${requestId} dismissedAfter=${String(dismissedPopoverRequestId)}.`,
  );
  floatingWindowAnchor = { ...anchor };
  activeAIRequestController?.abort();
  activeAIRequestController = null;
  return requestId;
}

function startTranslationRequest(
  snapshot: RequestSnapshot,
  existingRequestId?: number,
) {
  const requestId =
    existingRequestId ?? beginRequest(snapshot.word, snapshot.cursorAnchor);
  return {
    requestId,
    completion: executeAIRequest(snapshot, requestId),
  };
}

function handleAcceptedSelection(snapshot: SelectionSnapshot) {
  const word = snapshot.text.trim();
  if (!isSingleEnglishWord(word)) {
    console.log(
      `[selection-action] ignored accepted selection sample=${snapshot.sampleId} reason=invalid_single_english_word length=${word.length}`,
    );
    return null;
  }

  const requestSnapshot: RequestSnapshot = {
    word,
    source_app: snapshot.sourceApp,
    user_goal: DEFAULT_USER_GOAL,
    cursorAnchor: selectionAnchor(snapshot),
  };
  const request = startTranslationRequest(requestSnapshot);
  console.log(
    `[selection-action] translation started sample=${snapshot.sampleId} request=${request.requestId} app=${JSON.stringify(snapshot.sourceApp)}`,
  );
  return request.requestId;
}

async function handleDetectedWord(word: string) {
  selectionActionController?.dismissForExternalTrigger(
    "clipboard_request_started",
  );
  const anchor = screen.getCursorScreenPoint();
  const requestId = beginRequest(word, anchor);
  let snapshot: RequestSnapshot = {
    word,
    source_app: "Detecting...",
    user_goal: DEFAULT_USER_GOAL,
    cursorAnchor: { ...anchor },
  };
  try {
    await showFloatingState(
      { status: "loading", word, currentApplication: snapshot.source_app },
      requestId,
    );

    const currentApplication = await getFrontmostApplicationName();

    if (requestId !== latestAIRequestId) {
      return;
    }

    snapshot = { ...snapshot, source_app: currentApplication };
    await startTranslationRequest(snapshot, requestId).completion;
  } catch (error) {
    await showRequestFailure(error, snapshot, requestId, false);
  }
}

async function executeAIRequest(snapshot: RequestSnapshot, requestId: number) {
  let timedOut = false;
  try {
    await showFloatingState(
      { status: "loading", word: snapshot.word, currentApplication: snapshot.source_app },
      requestId,
    );

    if (requestId !== latestAIRequestId || applicationIsQuitting) return;

    const requestController = new AbortController();
    activeAIRequestController = requestController;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        requestController.abort();
      },
      AI_REQUEST_TIMEOUT_MS,
    );

    let result: ExplanationResult;

    try {
      result = await explanationService.generateExplanation(
        snapshot,
        { signal: requestController.signal },
      );
    } finally {
      clearTimeout(timeout);

      if (activeAIRequestController === requestController) {
        activeAIRequestController = null;
      }
    }

    if (requestId !== latestAIRequestId || applicationIsQuitting) {
      return;
    }

    await showFloatingState(
      { status: "result", result, currentApplication: snapshot.source_app },
      requestId,
    );
    console.log(`[ai] Explanation displayed for: ${snapshot.word}`);
  } catch (error) {
    await showRequestFailure(error, snapshot, requestId, timedOut);
  }
}

async function showRequestFailure(
  error: unknown,
  snapshot: RequestSnapshot,
  requestId: number,
  timedOut: boolean,
) {
  // Supersession is not a user-visible failure and must not replace the snapshot.
  if (requestId !== latestAIRequestId || applicationIsQuitting) return;

  let deviceOnline: boolean | undefined;
  try {
    deviceOnline = net.isOnline();
  } catch {
    // Uncertain device state is never evidence of Offline.
  }
  const classified = classifyFailure(error, timedOut, deviceOnline);
  failedRequest = { requestId, snapshot, failure: classified.failure };
  console.error(`[ai] Request ${requestId} failed: ${classified.failure.code}`);
  try {
    await showFloatingState({
      ...classified,
      word: snapshot.word,
      currentApplication: snapshot.source_app,
    }, requestId);
  } catch (windowError) {
    console.error("[floating] Failed to show error state:", windowError);
  }
}

function startClipboardMonitor() {
  let lastProcessedText = clipboard.readText();
  let pendingText: string | null = null;

  clipboardTimer = setInterval(() => {
    const currentClipboardText = clipboard.readText();

    if (currentClipboardText === lastProcessedText) {
      pendingText = null;
      return;
    }

    if (currentClipboardText !== pendingText) {
      pendingText = currentClipboardText;
      return;
    }

    lastProcessedText = currentClipboardText;
    pendingText = null;
    const normalizedText = currentClipboardText.trim();

    console.log("[clipboard]");

    if (isSingleEnglishWord(normalizedText)) {
      console.log(`Detected word: ${normalizedText}`);
      void handleDetectedWord(normalizedText);
      return;
    }

    console.log("Ignored: invalid input");
  }, CLIPBOARD_POLL_INTERVAL_MS);

  console.log("[clipboard] Monitoring started.");
}

function createTechnicalSpikeWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 440,
    title: "AI English Companion — Technical Spike",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[spike] Page failed to load (${code}): ${description}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[spike] Renderer process stopped: ${details.reason}`);
  });

  void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));

  mainWindow.once("ready-to-show", () => {
    console.log("[spike] Window opened successfully.");
  });

  mainWindow.webContents.once("did-finish-load", async () => {
    const visibleText = await mainWindow?.webContents.executeJavaScript(
      "document.body.innerText.trim()",
    );
    console.log(`[spike] Page rendered: ${JSON.stringify(visibleText)}`);

    if (isSmokeTest) {
      mainWindow?.close();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    console.log("[spike] Window closed; app is still running in the background.");

    if (isSmokeTest) {
      setTimeout(() => {
        if (mainWindow === null) {
          console.log("[spike] Background survival verified after window close.");
          app.quit();
        }
      }, 1_000);
    }
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (POPOVER_RENDERER === "react") {
      registerReactPopoverIpc();
    }

    console.log(
      `[app] Electron started pid=${process.pid} renderer=${POPOVER_RENDERER}`,
    );
    if (process.platform === "darwin" && app.isPackaged) {
      app.setActivationPolicy("accessory");
    }
    startApiKeySetupInfrastructure();
    startMenuBar();
    startPermissionStateInfrastructure();
    startGlobalMouseMonitor();
    startSelectionActionController();
    startClipboardMonitor();
    if (shouldCreateTechnicalSpikeWindow(app.isPackaged)) {
      createTechnicalSpikeWindow();
    }

    app.on("activate", () => {
      schedulePermissionRecheck();
      if (
        shouldCreateTechnicalSpikeWindow(app.isPackaged) &&
        mainWindow === null
      ) {
        createTechnicalSpikeWindow();
      }
    });
  });

  app.on("before-quit", () => {
    applicationIsQuitting = true;
  });

  app.on("will-quit", () => {
    applicationIsQuitting = true;
    activeAIRequestController?.abort();
    activeAIRequestController = null;

    if (clipboardTimer !== null) {
      clearInterval(clipboardTimer);
      clipboardTimer = null;
    }

    globalMouseMonitorProcess?.kill();
    globalMouseMonitorProcess = null;
    selectionActionController?.stop();
    selectionActionController = null;
    clearPermissionSetupReadyHideTimer();
    stopApiKeySetupInfrastructure();
    menuBarTray?.destroy();
    menuBarTray = null;
    stopPermissionStateInfrastructure();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
