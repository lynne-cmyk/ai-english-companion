import { contextBridge, ipcRenderer } from "electron";
import type {
  SelectionActionBridge,
  SelectionActionRendererState,
} from "./contracts";

// Sandboxed preloads cannot require local CommonJS modules. Keep the runtime
// values here while sharing only compile-time types with the main process.
const SELECTION_ACTION_CHANNELS = {
  ready: "selection-action:ready",
  state: "selection-action:state",
  pointerDown: "selection-action:pointer-down",
  click: "selection-action:click",
  rendered: "selection-action:rendered",
} as const;

function isRendererState(value: unknown): value is SelectionActionRendererState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<SelectionActionRendererState>;
  return (
    typeof state.visible === "boolean" &&
    (state.selectionId === null || typeof state.selectionId === "string")
  );
}

const bridge: SelectionActionBridge = {
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isRendererState(value)) listener(value);
    };
    ipcRenderer.on(SELECTION_ACTION_CHANNELS.state, handler);
    return () =>
      ipcRenderer.removeListener(SELECTION_ACTION_CHANNELS.state, handler);
  },
  pointerDown(selectionId) {
    if (typeof selectionId === "string" && selectionId.length <= 128) {
      ipcRenderer.send(SELECTION_ACTION_CHANNELS.pointerDown, selectionId);
    }
  },
  click(selectionId) {
    if (typeof selectionId === "string" && selectionId.length <= 128) {
      ipcRenderer.send(SELECTION_ACTION_CHANNELS.click, selectionId);
    }
  },
  rendered(selectionId, phase, metrics) {
    if (
      typeof selectionId === "string" &&
      selectionId.length <= 128 &&
      (phase === "mounted" || phase === "settled") &&
      metrics &&
      [
        metrics.width,
        metrics.height,
        metrics.opacity,
        metrics.devicePixelRatio,
      ].every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      ipcRenderer.send(
        SELECTION_ACTION_CHANNELS.rendered,
        selectionId,
        phase,
        metrics,
      );
    }
  },
  ready() {
    ipcRenderer.send(SELECTION_ACTION_CHANNELS.ready);
  },
};

contextBridge.exposeInMainWorld("selectionAction", bridge);
