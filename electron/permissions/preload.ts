import { contextBridge, ipcRenderer } from "electron";
import type {
  PermissionStateBridge,
  PermissionStateSnapshot,
} from "./contracts";

// Sandboxed preloads cannot require local CommonJS modules. Keep runtime
// channel values local while sharing compile-time types with the main process.
const channels = {
  getState: "permission-state:get",
  recheck: "permission-state:recheck",
  changed: "permission-state:changed",
} as const;

const statuses = new Set([
  "checking",
  "needs_accessibility",
  "needs_input_monitoring",
  "needs_both",
  "ready",
  "helper_unavailable",
  "indeterminate",
]);

function isPermissionState(value: unknown): value is PermissionStateSnapshot {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PermissionStateSnapshot>;
  return (
    typeof state.status === "string" &&
    statuses.has(state.status) &&
    ["unknown", "granted", "denied"].includes(
      state.accessibility ?? "",
    ) &&
    ["unknown", "operational", "unavailable"].includes(
      state.inputMonitoring ?? "",
    ) &&
    Number.isInteger(state.revision) &&
    (state.revision ?? -1) >= 0
  );
}

async function invokeState(channel: string) {
  const state: unknown = await ipcRenderer.invoke(channel);
  if (!isPermissionState(state)) {
    throw new Error("Invalid permission state response");
  }
  return state;
}

const bridge: PermissionStateBridge = {
  getState: () => invokeState(channels.getState),
  recheck: () => invokeState(channels.recheck),
  onStateChange(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isPermissionState(value)) listener(value);
    };
    ipcRenderer.on(channels.changed, handler);
    return () => ipcRenderer.removeListener(channels.changed, handler);
  },
};

contextBridge.exposeInMainWorld("permissionState", bridge);
