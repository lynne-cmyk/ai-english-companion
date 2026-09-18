import type {
  PermissionStateSnapshot,
  ProductPermissionStatus,
} from "./contracts";

export type PermissionSetupAction =
  | "open_accessibility"
  | "open_input_monitoring"
  | "recheck"
  | "relaunch";

export type PermissionRowState = "complete" | "current" | "pending";

export interface PermissionSetupViewModel {
  title: string;
  explanation: string;
  privacy?: string;
  fallback?: string;
  primaryAction?: PermissionSetupAction;
  primaryLabel?: string;
  secondaryAction?: PermissionSetupAction;
  secondaryLabel?: string;
  accessibilityRow: PermissionRowState;
  inputMonitoringRow: PermissionRowState;
  isSuccess: boolean;
  showPermissionRows?: boolean;
}

export function menuStatusLabel(status: ProductPermissionStatus) {
  if (status === "ready") return "● 已就绪";
  if (status === "checking") return "● 正在检查";
  return "● 需要设置权限";
}

export function shouldAutoOpenPermissionSetup(
  status: ProductPermissionStatus,
) {
  return status !== "checking" && status !== "ready";
}

export function shouldCreateTechnicalSpikeWindow(isPackaged: boolean) {
  return !isPackaged;
}

export function permissionSetupViewModel(
  state: PermissionStateSnapshot,
  restartRequired = false,
): PermissionSetupViewModel {
  if (restartRequired) {
    return {
      title: "需要重新打开 Tirva",
      explanation: "权限更改后，需要重新打开应用才能生效。",
      primaryAction: "relaunch",
      primaryLabel: "重新打开 Tirva",
      accessibilityRow:
        state.accessibility === "granted" ? "complete" : "pending",
      inputMonitoringRow: "current",
      isSuccess: false,
    };
  }

  switch (state.status) {
    case "checking":
      return {
        title: "正在检查使用状态…",
        explanation: "请稍候。",
        accessibilityRow: "pending",
        inputMonitoringRow: "pending",
        isSuccess: false,
      };
    case "needs_accessibility":
      return {
        title: "允许读取所选单词",
        explanation: "用于识别你主动选中的英文单词。",
        privacy: "仅在你进行选择时读取所选文字。",
        fallback: "你仍可复制单词进行翻译。",
        primaryAction: "open_accessibility",
        primaryLabel: "打开“辅助功能”设置",
        secondaryAction: "recheck",
        secondaryLabel: "重新检查",
        accessibilityRow: "current",
        inputMonitoringRow:
          state.inputMonitoring === "operational" ? "complete" : "pending",
        isSuccess: false,
      };
    case "needs_input_monitoring":
      return {
        title: "允许识别双击",
        explanation: "用于识别鼠标双击，并显示翻译按钮。",
        privacy: "此功能不读取你输入的键盘内容。",
        fallback: "你仍可复制单词进行翻译。",
        primaryAction: "open_input_monitoring",
        primaryLabel: "打开“输入监控”设置",
        secondaryAction: "recheck",
        secondaryLabel: "重新检查",
        accessibilityRow: "complete",
        inputMonitoringRow: "current",
        isSuccess: false,
      };
    case "needs_both":
      return {
        title: "完成使用设置",
        explanation: "启用两项系统权限，即可双击英文单词并使用 ✦ 翻译。",
        privacy: "先允许读取所选单词，再允许识别双击。",
        fallback: "你仍可复制单词进行翻译。",
        primaryAction: "open_accessibility",
        primaryLabel: "打开“辅助功能”设置",
        secondaryAction: "recheck",
        secondaryLabel: "重新检查",
        accessibilityRow: "current",
        inputMonitoringRow: "pending",
        isSuccess: false,
      };
    case "ready":
      return {
        title: "设置完成",
        explanation: "现在双击英文单词即可使用。",
        accessibilityRow: "complete",
        inputMonitoringRow: "complete",
        isSuccess: true,
      };
    case "helper_unavailable":
      return {
        title: "文字选择功能暂时无法启动",
        explanation: "请重试或重新打开应用。",
        fallback: "你仍可复制单词进行翻译。",
        primaryAction: "recheck",
        primaryLabel: "重试",
        secondaryAction: "relaunch",
        secondaryLabel: "重新打开应用",
        accessibilityRow:
          state.accessibility === "granted" ? "complete" : "pending",
        inputMonitoringRow:
          state.inputMonitoring === "operational" ? "complete" : "pending",
        isSuccess: false,
        showPermissionRows: false,
      };
    case "indeterminate":
      return {
        title: "暂时无法确认权限状态",
        explanation: "请重新检查。",
        fallback: "你仍可复制单词进行翻译。",
        primaryAction: "recheck",
        primaryLabel: "重新检查",
        secondaryAction: "relaunch",
        secondaryLabel: "重新打开应用",
        accessibilityRow:
          state.accessibility === "granted" ? "complete" : "pending",
        inputMonitoringRow:
          state.inputMonitoring === "operational" ? "complete" : "pending",
        isSuccess: false,
        showPermissionRows: false,
      };
  }
}
