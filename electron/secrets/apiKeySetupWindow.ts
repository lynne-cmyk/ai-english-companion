export interface ApiKeySetupWindowLike {
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  focus(): void;
  hide(): void;
}

export class ApiKeySetupWindowManager<
  TWindow extends ApiKeySetupWindowLike,
> {
  private setupWindow: TWindow | null = null;

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
    return true;
  }
}
