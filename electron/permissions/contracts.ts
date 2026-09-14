export const PERMISSION_STATE_CHANNELS = {
  getState: "permission-state:get",
  recheck: "permission-state:recheck",
  changed: "permission-state:changed",
  openAccessibilitySettings: "permission-state:open-accessibility-settings",
  openInputMonitoringSettings:
    "permission-state:open-input-monitoring-settings",
  relaunch: "permission-state:relaunch",
} as const;

export type AccessibilityPermissionState = "unknown" | "granted" | "denied";

export type InputMonitoringPermissionState =
  | "unknown"
  | "operational"
  | "unavailable";

export type ProductPermissionStatus =
  | "checking"
  | "needs_accessibility"
  | "needs_input_monitoring"
  | "needs_both"
  | "ready"
  | "helper_unavailable"
  | "indeterminate";

export interface PermissionStateSnapshot {
  status: ProductPermissionStatus;
  accessibility: AccessibilityPermissionState;
  inputMonitoring: InputMonitoringPermissionState;
  revision: number;
}

export interface PermissionStateBridge {
  getState(): Promise<PermissionStateSnapshot>;
  recheck(): Promise<PermissionStateSnapshot>;
  openAccessibilitySettings(): Promise<void>;
  openInputMonitoringSettings(): Promise<void>;
  relaunch(): Promise<void>;
  onStateChange(
    listener: (state: PermissionStateSnapshot) => void,
  ): () => void;
}
