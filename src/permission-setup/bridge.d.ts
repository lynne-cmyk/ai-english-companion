import type { PermissionStateBridge } from "../../electron/permissions/contracts";

declare global {
  interface Window {
    permissionState: PermissionStateBridge;
  }
}

export {};
