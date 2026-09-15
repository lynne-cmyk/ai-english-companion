export type LoginItemState =
  | "enabled"
  | "disabled"
  | "requires_approval"
  | "unavailable";

export type MainAppServiceStatus =
  | "not-registered"
  | "enabled"
  | "requires-approval"
  | "not-found";

export interface LoginItemSettingsSnapshot {
  status: MainAppServiceStatus | string;
}

export interface LoginItemApi {
  getLoginItemSettings(options: {
    type: "mainAppService";
  }): LoginItemSettingsSnapshot;
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    type: "mainAppService";
  }): void;
}

export interface LoginItemMenuBindings {
  toggle: { checked: boolean };
  approvalGuidance: { visible: boolean };
}

interface LoginItemServiceOptions {
  api: LoginItemApi;
  isPackaged: boolean;
  log?: (message: string) => void;
}

const MAIN_APP_SERVICE_OPTIONS = { type: "mainAppService" } as const;

export function mapLoginItemStatus(status: string): LoginItemState {
  switch (status) {
    case "enabled":
      return "enabled";
    case "not-registered":
      return "disabled";
    case "requires-approval":
      return "requires_approval";
    case "not-found":
    default:
      return "unavailable";
  }
}

export function loginItemMenuPresentation(state: LoginItemState) {
  return {
    checked: state === "enabled",
    showApprovalGuidance: state === "requires_approval",
  };
}

export function applyLoginItemStateToMenu(
  state: LoginItemState,
  bindings: LoginItemMenuBindings,
) {
  const presentation = loginItemMenuPresentation(state);
  bindings.toggle.checked = presentation.checked;
  bindings.approvalGuidance.visible = presentation.showApprovalGuidance;
}

export function refreshLoginItemMenu(
  service: LoginItemService,
  bindings: LoginItemMenuBindings,
) {
  const state = service.getState();
  applyLoginItemStateToMenu(state, bindings);
  return state;
}

export class LoginItemService {
  private readonly log: (message: string) => void;

  constructor(private readonly options: LoginItemServiceOptions) {
    this.log = options.log ?? (() => undefined);
  }

  getState(): LoginItemState {
    if (!this.options.isPackaged) return "disabled";

    try {
      const settings = this.options.api.getLoginItemSettings(
        MAIN_APP_SERVICE_OPTIONS,
      );
      return mapLoginItemStatus(settings.status);
    } catch {
      this.log("[login-item] read failed category=unavailable");
      return "unavailable";
    }
  }

  setEnabled(enabled: boolean): LoginItemState {
    if (!this.options.isPackaged) {
      this.log("[login-item] write ignored category=development");
      return "disabled";
    }

    try {
      this.options.api.setLoginItemSettings({
        openAtLogin: enabled,
        ...MAIN_APP_SERVICE_OPTIONS,
      });
    } catch {
      this.log("[login-item] write failed category=unavailable");
      return "unavailable";
    }

    return this.getState();
  }
}
