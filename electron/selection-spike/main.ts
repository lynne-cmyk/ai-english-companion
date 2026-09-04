import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
} from "electron";
import {
  SELECTION_ACTION_CHANNELS,
  type Rect,
  type SelectionActionRenderMetrics,
  type SelectionActionRendererState,
} from "./contracts";
import {
  ACTION_WINDOW_SIZE,
  calculateActionPosition,
  isValidSelectionBounds,
} from "./position";
import {
  ProbeSampleParser,
  SelectionSession,
  type SelectionSnapshot,
} from "./selectionSession";

const APP_NAME = "AI English Companion Selection Action Spike";
const repoRoot = path.resolve(__dirname, "../..");
const rendererPath = path.join(repoRoot, "dist/selection-action.html");
const probePath = path.join(repoRoot, "dist-native/selection-probe");
const preloadPath = path.join(__dirname, "preload.js");

let buttonWindow: BrowserWindow | null = null;
let probeProcess: ChildProcessWithoutNullStreams | null = null;
let rendererReady = false;
let rendererLoaded = false;
let quitting = false;
let currentRendererState: SelectionActionRendererState = {
  visible: false,
  selectionId: null,
};

const parser = new ProbeSampleParser();
const session = new SelectionSession();

app.setName(APP_NAME);
app.setPath(
  "userData",
  path.join(app.getPath("appData"), "ai-english-companion-selection-action-spike"),
);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function isExperimentalSender(event: IpcMainEvent) {
  return (
    buttonWindow !== null &&
    !buttonWindow.isDestroyed() &&
    event.sender === buttonWindow.webContents
  );
}

function isOpaqueSelectionId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function sendRendererState(state: SelectionActionRendererState) {
  currentRendererState = state;
  if (
    rendererReady &&
    buttonWindow &&
    !buttonWindow.isDestroyed() &&
    !buttonWindow.webContents.isDestroyed()
  ) {
    buttonWindow.webContents.send(SELECTION_ACTION_CHANNELS.state, state);
    return true;
  }
  return false;
}

function lifecycleState() {
  const currentWindow = buttonWindow;
  const windowAvailable =
    currentWindow !== null && !currentWindow.isDestroyed();
  return {
    liveSelectionId: session.current?.selectionId ?? null,
    latestHandledSampleId: session.latestHandledSampleId,
    rendererState: currentRendererState,
    windowId: windowAvailable ? currentWindow.id : null,
    windowVisible: windowAvailable ? currentWindow.isVisible() : false,
  };
}

function hideButton(reason: string) {
  const before = lifecycleState();
  sendRendererState({ visible: false, selectionId: null });
  if (buttonWindow && !buttonWindow.isDestroyed()) buttonWindow.hide();
  console.log(
    `[selection-action] hidden ${JSON.stringify({
      reason,
      before,
      after: lifecycleState(),
    })}`,
  );
}

function invalidateButton(reason: string) {
  session.clear();
  hideButton(reason);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function resultValue(value: unknown) {
  return asRecord(value)?.value;
}

function probeDiagnostic(value: unknown) {
  const sample = asRecord(value);
  const app = asRecord(sample?.app);
  const selectedText = asRecord(sample?.selected_text);
  const selectedRange = asRecord(sample?.range);
  const selectedBounds = asRecord(sample?.bounds);
  const selectedValue = selectedText?.value;
  return {
    sampleId: sample?.sampleId ?? null,
    appName: typeof app?.name === "string" ? app.name : null,
    focusedElementStatus: asRecord(sample?.focused_element)?.status ?? null,
    focusedRole: resultValue(sample?.role) ?? null,
    hitTestStatus: asRecord(sample?.hit_test)?.status ?? null,
    hitTestRole: sample?.hit_test_role ?? null,
    candidateSource: sample?.candidate_source ?? null,
    candidateRole: sample?.candidate_role ?? null,
    usableSelection: sample?.usable_selection === true,
    stale: sample?.stale === true,
    discarded: sample?.discarded === true,
    accessibility: sample?.accessibility ?? null,
    selectedTextStatus: selectedText?.status ?? null,
    selectedTextAxError: selectedText?.ax_error_name ?? null,
    selectedTextLength:
      typeof selectedValue === "string" ? selectedValue.length : 0,
    rangeStatus: selectedRange?.status ?? null,
    rangeAxError: selectedRange?.ax_error_name ?? null,
    boundsStatus: selectedBounds?.status ?? null,
    boundsAxError: selectedBounds?.ax_error_name ?? null,
    queryStopReason: sample?.query_stop_reason ?? null,
    diagnostic: sample?.diagnostic ?? null,
  };
}

function chooseDisplay(snapshot: SelectionSnapshot) {
  const initialPoint = snapshot.bounds
    ? {
        x: snapshot.bounds.x + snapshot.bounds.width / 2,
        y: snapshot.bounds.y + snapshot.bounds.height / 2,
      }
    : snapshot.mousePosition;
  let display = screen.getDisplayNearestPoint(initialPoint);

  if (!isValidSelectionBounds(snapshot.bounds, display.workArea)) {
    display = screen.getDisplayNearestPoint(snapshot.mousePosition);
  }
  return display;
}

function showButton(snapshot: SelectionSnapshot) {
  if (!buttonWindow || buttonWindow.isDestroyed()) return;
  if (!session.associateWindow(snapshot.selectionId)) return;

  const display = chooseDisplay(snapshot);
  const position = calculateActionPosition({
    selectionBounds: snapshot.bounds,
    mousePosition: snapshot.mousePosition,
    workArea: display.workArea,
  });
  const requestedBounds = {
    x: position.x,
    y: position.y,
    width: ACTION_WINDOW_SIZE,
    height: ACTION_WINDOW_SIZE,
  };

  buttonWindow.hide();
  buttonWindow.setBounds(requestedBounds, false);
  const stateSent = sendRendererState({
    visible: true,
    selectionId: snapshot.selectionId,
  });

  if (!rendererLoaded || !rendererReady || !stateSent) {
    console.log(
      `[selection-action] show_deferred sample=${snapshot.sampleId} ` +
        `rendererLoaded=${rendererLoaded} rendererReady=${rendererReady} stateSent=${stateSent}`,
    );
    return;
  }

  buttonWindow.showInactive();
  const actualBounds = buttonWindow.getBounds();
  console.log(
    `[selection-action] shown ${JSON.stringify({
      sampleId: snapshot.sampleId,
      textLength: snapshot.text.length,
      rawSelectionBounds: snapshot.bounds ?? null,
      rawMousePosition: snapshot.mousePosition,
      coordinateConversion: "none",
      anchorSource: position.anchorSource,
      placement: position.placement,
      flipped: position.flipped,
      displayId: display.id,
      scaleFactor: display.scaleFactor,
      workArea: display.workArea,
      requestedBounds,
      actualBounds,
      visible: buttonWindow.isVisible(),
      destroyed: buttonWindow.isDestroyed(),
      opacity: buttonWindow.getOpacity(),
      rendererLoaded,
      rendererReady,
      stateSent,
      rendererUrl: buttonWindow.webContents.getURL(),
    })}`,
  );
}

function handleProbeSample(value: unknown) {
  const before = lifecycleState();
  const update = session.handleProbe(value);
  if (update.kind === "show") {
    showButton(update.snapshot);
  } else if (update.kind === "hide") {
    hideButton(update.reason);
    if (update.reason === "permission_required") {
      console.warn(
        "[selection-action] permission_required: grant Accessibility permission manually; no prompt was opened.",
      );
    }
  } else if (update.reason === "invalid_probe_record") {
    invalidateButton(update.reason);
  } else if (update.reason !== "older_stale_probe_record") {
    console.log(`[selection-action] ignored reason=${update.reason}`);
  }
  console.log(
    `[selection-action] sample_lifecycle ${JSON.stringify({
      ...probeDiagnostic(value),
      outcome: update.kind,
      reason: "reason" in update ? update.reason : "usable_selection",
      before,
      after: lifecycleState(),
    })}`,
  );
}

function startProbe() {
  const child = spawn(probePath, [], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  probeProcess = child;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    for (const event of parser.push(chunk)) {
      if (event.type === "sample") handleProbeSample(event.value);
      else if (event.type === "overflow") {
        invalidateButton("probe_record_overflow");
        console.warn(
          `[selection-action] probe_overflow reason=${event.reason} ` +
            `observedBytes=${event.observedBytes} limitBytes=${event.limitBytes}`,
        );
      } else {
        invalidateButton("probe_record_malformed");
        console.warn(`[selection-action] probe_malformed reason=${event.reason}`);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    const message = chunk.trim();
    if (message) console.warn(`[selection-probe] ${message}`);
  });

  child.on("error", (error) => {
    invalidateButton("probe_process_error");
    console.error(`[selection-action] probe failed: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (probeProcess === child) probeProcess = null;
    invalidateButton("probe_process_exit");
    if (!quitting) {
      console.warn(`[selection-action] probe exited code=${code} signal=${signal}`);
    }
  });
}

function createButtonWindow() {
  buttonWindow = new BrowserWindow({
    width: ACTION_WINDOW_SIZE,
    height: ACTION_WINDOW_SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    acceptFirstMouse: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  buttonWindow.setAlwaysOnTop(true, "floating");
  buttonWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  buttonWindow.webContents.on("did-start-loading", () => {
    rendererLoaded = false;
  });
  buttonWindow.webContents.on("did-finish-load", () => {
    rendererLoaded = true;
    console.log(
      `[selection-action] renderer_loaded url=${buttonWindow?.webContents.getURL() ?? "destroyed"}`,
    );
    const snapshot = session.current;
    if (snapshot && !snapshot.consumed) showButton(snapshot);
    else sendRendererState({ visible: false, selectionId: null });
  });
  buttonWindow.webContents.on("render-process-gone", (_event, details) => {
    rendererLoaded = false;
    rendererReady = false;
    invalidateButton(`renderer_gone_${details.reason}`);
  });
  buttonWindow.on("closed", () => {
    buttonWindow = null;
    rendererReady = false;
    rendererLoaded = false;
    session.clear();
  });
  void buttonWindow.loadFile(rendererPath, { query: { mode: "window" } });
}

function registerIpc() {
  ipcMain.on(SELECTION_ACTION_CHANNELS.ready, (event) => {
    if (!isExperimentalSender(event)) return;
    rendererReady = true;
    console.log(
      `[selection-action] renderer_ready loaded=${rendererLoaded} ` +
        `url=${buttonWindow?.webContents.getURL() ?? "destroyed"}`,
    );
    const snapshot = session.current;
    if (snapshot && !snapshot.consumed) showButton(snapshot);
    else sendRendererState({ visible: false, selectionId: null });
  });

  ipcMain.on(SELECTION_ACTION_CHANNELS.pointerDown, (event, selectionId) => {
    if (!isOpaqueSelectionId(selectionId) || !buttonWindow) return;
    const validSender = isExperimentalSender(event);
    session.beginButtonInteraction(
      selectionId,
      buttonWindow.getBounds() as Rect,
      validSender,
    );
  });

  ipcMain.on(SELECTION_ACTION_CHANNELS.click, (event, selectionId) => {
    if (!isOpaqueSelectionId(selectionId)) return;
    const snapshot = session.consumeClick(
      selectionId,
      isExperimentalSender(event),
    );
    if (!snapshot) {
      console.warn("[selection-action] rejected click: stale or invalid selection id");
      return;
    }

    const safeText = snapshot.text.replace(/\s+/g, " ").slice(0, 80);
    console.log(
      `[selection-action] clicked sample=${snapshot.sampleId} ` +
        `text=${JSON.stringify(safeText)} app=${JSON.stringify(snapshot.sourceApp)}`,
    );
    hideButton("action_consumed");
  });

  ipcMain.on(
    SELECTION_ACTION_CHANNELS.rendered,
    (event, selectionId, phase, metrics: SelectionActionRenderMetrics) => {
      if (
        !isExperimentalSender(event) ||
        !isOpaqueSelectionId(selectionId) ||
        (phase !== "mounted" && phase !== "settled") ||
        !metrics ||
        ![metrics.width, metrics.height, metrics.opacity, metrics.devicePixelRatio].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ) ||
        session.current?.selectionId !== selectionId
      ) {
        return;
      }
      console.log(
        `[selection-action] renderer_${phase} ${JSON.stringify({
          sampleId: session.current.sampleId,
          selectionId,
          ...metrics,
        })}`,
      );
    },
  );
}

function stopExperiment() {
  quitting = true;
  session.clear();
  if (buttonWindow && !buttonWindow.isDestroyed()) buttonWindow.hide();
  probeProcess?.kill("SIGTERM");
  probeProcess = null;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    console.log("[selection-action] second experiment instance rejected");
  });
  app.on("before-quit", stopExperiment);
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(() => {
    console.log(`[selection-action] experiment started pid=${process.pid}`);
    registerIpc();
    createButtonWindow();
    startProbe();
  });
}
