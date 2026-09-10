import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
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

export interface SelectionActionControllerOptions {
  repoRoot: string;
  rendererPath: string;
  probePath: string;
  probeWorkingDirectory?: string;
  preloadPath: string;
  onAcceptedSelection(snapshot: SelectionSnapshot): void | Promise<void>;
}

function isOpaqueSelectionId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
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
  const application = asRecord(sample?.app);
  const selectedText = asRecord(sample?.selected_text);
  const selectedRange = asRecord(sample?.range);
  const selectedBounds = asRecord(sample?.bounds);
  const gesture = asRecord(sample?.gesture);
  const selectedValue = selectedText?.value;
  const selectedRangeValue = asRecord(selectedRange?.value);
  return {
    sampleId: sample?.sampleId ?? null,
    appName:
      typeof application?.name === "string" ? application.name : null,
    pid: application?.pid ?? null,
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
    rangeLocation: selectedRangeValue?.location ?? null,
    rangeLength: selectedRangeValue?.length ?? null,
    boundsStatus: selectedBounds?.status ?? null,
    boundsAxError: selectedBounds?.ax_error_name ?? null,
    queryStopReason: sample?.query_stop_reason ?? null,
    gestureGeneration: gesture?.generation ?? null,
    gestureButton: gesture?.button ?? null,
    gestureClickCount: gesture?.clickCount ?? null,
    gestureDidDrag: gesture?.didDrag === true,
    gestureMaxDragDistance: gesture?.maxDragDistance ?? null,
    gestureComplete: gesture?.complete === true,
    diagnostic: sample?.diagnostic ?? null,
  };
}

export class SelectionActionController {
  private buttonWindow: BrowserWindow | null = null;
  private probeProcess: ChildProcessWithoutNullStreams | null = null;
  private rendererReady = false;
  private rendererLoaded = false;
  private started = false;
  private quitting = false;
  private currentRendererState: SelectionActionRendererState = {
    visible: false,
    selectionId: null,
  };
  private readonly parser = new ProbeSampleParser();
  private readonly session = new SelectionSession();

  constructor(private readonly options: SelectionActionControllerOptions) {}

  start() {
    if (this.started) return false;
    this.started = true;
    this.quitting = false;
    this.registerIpc();
    this.createButtonWindow();
    this.startProbe();
    return true;
  }

  dismissForExternalTrigger(reason: string) {
    this.invalidateButton(reason);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.quitting = true;
    this.unregisterIpc();
    this.session.clear();
    this.sendRendererState({ visible: false, selectionId: null });

    const window = this.buttonWindow;
    this.buttonWindow = null;
    if (window && !window.isDestroyed()) window.destroy();

    const child = this.probeProcess;
    this.probeProcess = null;
    if (child && !child.killed) child.kill("SIGTERM");
  }

  private readonly handleReady = (event: IpcMainEvent) => {
    if (!this.isControllerSender(event)) return;
    this.rendererReady = true;
    console.log(
      `[selection-action] renderer_ready loaded=${this.rendererLoaded} ` +
        `url=${this.buttonWindow?.webContents.getURL() ?? "destroyed"}`,
    );
    const snapshot = this.session.current;
    if (snapshot && !snapshot.consumed) this.showButton(snapshot);
    else this.sendRendererState({ visible: false, selectionId: null });
  };

  private readonly handlePointerDown = (
    event: IpcMainEvent,
    selectionId: unknown,
  ) => {
    if (!isOpaqueSelectionId(selectionId) || !this.buttonWindow) return;
    this.session.beginButtonInteraction(
      selectionId,
      this.buttonWindow.getBounds() as Rect,
      this.isControllerSender(event),
    );
  };

  private readonly handleClick = (
    event: IpcMainEvent,
    selectionId: unknown,
  ) => {
    if (!isOpaqueSelectionId(selectionId)) return;
    const snapshot = this.session.consumeClick(
      selectionId,
      this.isControllerSender(event),
    );
    if (!snapshot) {
      console.warn(
        "[selection-action] rejected click: stale or invalid selection id",
      );
      return;
    }

    this.hideButton("action_consumed");
    console.log(
      `[selection-action] consumed ${JSON.stringify({
        sampleId: snapshot.sampleId,
        ...this.session.diagnosticState(),
        rendererVisible: this.currentRendererState.visible,
        windowVisible: this.buttonWindow?.isVisible() ?? false,
      })}`,
    );
    let callbackResult: void | Promise<void>;
    try {
      callbackResult = this.options.onAcceptedSelection(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[selection-action] accepted callback failed: ${message}`);
      return;
    }
    Promise.resolve(callbackResult).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[selection-action] accepted callback failed: ${message}`);
    });
  };

  private readonly handleRendered = (
    event: IpcMainEvent,
    selectionId: unknown,
    phase: unknown,
    metrics: SelectionActionRenderMetrics,
  ) => {
    if (
      !this.isControllerSender(event) ||
      !isOpaqueSelectionId(selectionId) ||
      (phase !== "mounted" && phase !== "settled") ||
      !metrics ||
      [
        metrics.width,
        metrics.height,
        metrics.opacity,
        metrics.devicePixelRatio,
      ].some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
      this.session.current?.selectionId !== selectionId
    ) {
      return;
    }
    console.log(
      `[selection-action] renderer_${phase} ${JSON.stringify({
        sampleId: this.session.current.sampleId,
        selectionId,
        ...metrics,
      })}`,
    );
  };

  private registerIpc() {
    ipcMain.on(SELECTION_ACTION_CHANNELS.ready, this.handleReady);
    ipcMain.on(SELECTION_ACTION_CHANNELS.pointerDown, this.handlePointerDown);
    ipcMain.on(SELECTION_ACTION_CHANNELS.click, this.handleClick);
    ipcMain.on(SELECTION_ACTION_CHANNELS.rendered, this.handleRendered);
  }

  private unregisterIpc() {
    ipcMain.removeListener(SELECTION_ACTION_CHANNELS.ready, this.handleReady);
    ipcMain.removeListener(
      SELECTION_ACTION_CHANNELS.pointerDown,
      this.handlePointerDown,
    );
    ipcMain.removeListener(SELECTION_ACTION_CHANNELS.click, this.handleClick);
    ipcMain.removeListener(SELECTION_ACTION_CHANNELS.rendered, this.handleRendered);
  }

  private isControllerSender(event: IpcMainEvent) {
    return (
      this.buttonWindow !== null &&
      !this.buttonWindow.isDestroyed() &&
      event.sender === this.buttonWindow.webContents &&
      event.senderFrame === this.buttonWindow.webContents.mainFrame
    );
  }

  private sendRendererState(state: SelectionActionRendererState) {
    this.currentRendererState = state;
    if (
      this.rendererReady &&
      this.buttonWindow &&
      !this.buttonWindow.isDestroyed() &&
      !this.buttonWindow.webContents.isDestroyed()
    ) {
      this.buttonWindow.webContents.send(SELECTION_ACTION_CHANNELS.state, state);
      return true;
    }
    return false;
  }

  private lifecycleState() {
    const currentWindow = this.buttonWindow;
    const windowAvailable =
      currentWindow !== null && !currentWindow.isDestroyed();
    return {
      ...this.session.diagnosticState(),
      rendererState: this.currentRendererState,
      rendererVisible: this.currentRendererState.visible,
      windowId: windowAvailable ? currentWindow.id : null,
      windowVisible: windowAvailable ? currentWindow.isVisible() : false,
    };
  }

  private hideButton(reason: string) {
    const before = this.lifecycleState();
    this.sendRendererState({ visible: false, selectionId: null });
    if (this.buttonWindow && !this.buttonWindow.isDestroyed()) {
      this.buttonWindow.hide();
    }
    console.log(
      `[selection-action] hidden ${JSON.stringify({
        reason,
        before,
        after: this.lifecycleState(),
      })}`,
    );
  }

  private invalidateButton(reason: string) {
    this.session.clear();
    this.hideButton(reason);
  }

  private chooseDisplay(snapshot: SelectionSnapshot) {
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

  private showButton(snapshot: SelectionSnapshot) {
    if (!this.buttonWindow || this.buttonWindow.isDestroyed()) return;
    if (!this.session.associateWindow(snapshot.selectionId)) return;

    const display = this.chooseDisplay(snapshot);
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

    this.buttonWindow.hide();
    this.buttonWindow.setBounds(requestedBounds, false);
    const stateSent = this.sendRendererState({
      visible: true,
      selectionId: snapshot.selectionId,
    });

    if (!this.rendererLoaded || !this.rendererReady || !stateSent) {
      console.log(
        `[selection-action] show_deferred sample=${snapshot.sampleId} ` +
          `rendererLoaded=${this.rendererLoaded} rendererReady=${this.rendererReady} ` +
          `stateSent=${stateSent}`,
      );
      return;
    }

    this.buttonWindow.showInactive();
    const actualBounds = this.buttonWindow.getBounds();
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
        visible: this.buttonWindow.isVisible(),
        destroyed: this.buttonWindow.isDestroyed(),
        opacity: this.buttonWindow.getOpacity(),
        rendererLoaded: this.rendererLoaded,
        rendererReady: this.rendererReady,
        stateSent,
        rendererUrl: this.buttonWindow.webContents.getURL(),
      })}`,
    );
  }

  private handleProbeSample(value: unknown) {
    const before = this.lifecycleState();
    const decision = this.session.diagnoseProbe(value);
    const update = this.session.handleProbe(value);
    if (update.kind === "show") {
      this.showButton(update.snapshot);
    } else if (update.kind === "hide") {
      this.hideButton(update.reason);
      if (update.reason === "permission_required") {
        console.warn(
          "[selection-action] permission_required: grant Accessibility permission manually; no prompt was opened.",
        );
      }
    } else if (update.reason === "invalid_probe_record") {
      this.invalidateButton(update.reason);
    } else if (update.reason !== "older_stale_probe_record") {
      console.log(`[selection-action] ignored reason=${update.reason}`);
    }
    console.log(
      `[selection-action] sample_lifecycle ${JSON.stringify({
        ...probeDiagnostic(value),
        ...decision,
        outcome: update.kind === "ignore" ? "suppress" : update.kind,
        reason: "reason" in update ? update.reason : "usable_selection",
        before,
        after: this.lifecycleState(),
      })}`,
    );
  }

  private startProbe() {
    if (this.probeProcess !== null || this.quitting) return;
    const child = spawn(this.options.probePath, [], {
      cwd: this.options.probeWorkingDirectory ?? this.options.repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    this.probeProcess = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const event of this.parser.push(chunk)) {
        if (event.type === "sample") this.handleProbeSample(event.value);
        else if (event.type === "overflow") {
          this.invalidateButton("probe_record_overflow");
          console.warn(
            `[selection-action] probe_overflow reason=${event.reason} ` +
              `observedBytes=${event.observedBytes} limitBytes=${event.limitBytes}`,
          );
        } else {
          this.invalidateButton("probe_record_malformed");
          console.warn(
            `[selection-action] probe_malformed reason=${event.reason}`,
          );
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) console.warn(`[selection-probe] ${message}`);
    });

    child.on("error", (error) => {
      if (this.probeProcess === child) this.probeProcess = null;
      this.invalidateButton("probe_process_error");
      console.error(`[selection-action] probe failed: ${error.message}`);
    });

    child.on("exit", (code, signal) => {
      if (this.probeProcess === child) this.probeProcess = null;
      this.invalidateButton("probe_process_exit");
      if (!this.quitting) {
        console.warn(
          `[selection-action] probe exited code=${code} signal=${signal}`,
        );
      }
    });
  }

  private createButtonWindow() {
    this.buttonWindow = new BrowserWindow({
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
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.buttonWindow.setAlwaysOnTop(true, "floating");
    this.buttonWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    this.buttonWindow.webContents.on("did-start-loading", () => {
      this.rendererLoaded = false;
    });
    this.buttonWindow.webContents.on("did-finish-load", () => {
      this.rendererLoaded = true;
      console.log(
        `[selection-action] renderer_loaded url=${this.buttonWindow?.webContents.getURL() ?? "destroyed"}`,
      );
      const snapshot = this.session.current;
      if (snapshot && !snapshot.consumed) this.showButton(snapshot);
      else this.sendRendererState({ visible: false, selectionId: null });
    });
    this.buttonWindow.webContents.on("render-process-gone", (_event, details) => {
      this.rendererLoaded = false;
      this.rendererReady = false;
      this.invalidateButton(`renderer_gone_${details.reason}`);
    });
    this.buttonWindow.on("closed", () => {
      this.buttonWindow = null;
      this.rendererReady = false;
      this.rendererLoaded = false;
      this.session.clear();
    });
    void this.buttonWindow.loadFile(this.options.rendererPath, {
      query: { mode: "window" },
    });
  }
}
