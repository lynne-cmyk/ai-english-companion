import type { ProductPermissionStatus } from "./contracts";

export type PermissionSetupOpenReason = "automatic" | "manual";

export interface PermissionSetupWindowLike {
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  focus(): void;
  hide(): void;
}

export class PermissionSetupWindowManager<
  TWindow extends PermissionSetupWindowLike,
> {
  private setupWindow: TWindow | null = null;
  private openReason: PermissionSetupOpenReason | null = null;
  private previousPermissionStatus: ProductPermissionStatus | null = null;
  private readyAutoHidePending = false;

  get current() {
    if (this.setupWindow?.isDestroyed()) this.setupWindow = null;
    return this.setupWindow;
  }

  ensure(createWindow: () => TWindow) {
    const existing = this.current;
    if (existing !== null) return existing;
    this.setupWindow = createWindow();
    return this.setupWindow;
  }

  requestOpen(reason: PermissionSetupOpenReason) {
    if (reason === "manual") {
      this.openReason = "manual";
      this.readyAutoHidePending = false;
      return;
    }
    if (this.openReason !== "manual") this.openReason = "automatic";
  }

  observePermissionStatus(status: ProductPermissionStatus) {
    const enteredReady =
      this.previousPermissionStatus !== null &&
      this.previousPermissionStatus !== "ready" &&
      status === "ready";
    this.previousPermissionStatus = status;

    if (status !== "ready") this.readyAutoHidePending = false;
    if (enteredReady && this.openReason === "automatic") {
      this.readyAutoHidePending = true;
    }
  }

  takeReadyAutoHideRequest() {
    if (this.openReason !== "automatic" || !this.readyAutoHidePending) {
      return false;
    }
    this.readyAutoHidePending = false;
    return true;
  }

  clearOpenContext() {
    this.openReason = null;
    this.readyAutoHidePending = false;
  }

  show() {
    const window = this.current;
    if (window === null) return false;
    if (!window.isVisible()) window.show();
    window.focus();
    return true;
  }

  hide() {
    const window = this.current;
    if (window === null || !window.isVisible()) return false;
    window.hide();
    return true;
  }

  release(window: TWindow) {
    if (this.setupWindow !== window) return false;
    this.setupWindow = null;
    this.clearOpenContext();
    return true;
  }
}
