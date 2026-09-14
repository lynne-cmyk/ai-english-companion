import { useEffect, useMemo, useState } from "react";
import type { PermissionStateSnapshot } from "../../electron/permissions/contracts";
import {
  permissionSetupViewModel,
  type PermissionRowState,
  type PermissionSetupAction,
} from "../../electron/permissions/setupPresentation";

const INITIAL_STATE: PermissionStateSnapshot = {
  status: "checking",
  accessibility: "unknown",
  inputMonitoring: "unknown",
  revision: 0,
};

function PermissionRow({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: PermissionRowState;
}) {
  const stateLabel =
    state === "complete" ? "已完成" : state === "current" ? "需要操作" : "待完成";
  return (
    <li className={`permission-row permission-row--${state}`}>
      <span className="permission-row__icon" aria-hidden="true">
        {state === "complete" ? "✓" : ""}
      </span>
      <span className="permission-row__copy">
        <strong>{label}</strong>
        <span>{detail}</span>
      </span>
      <span className="permission-row__state">{stateLabel}</span>
    </li>
  );
}

export function PermissionSetup() {
  const [state, setState] = useState(INITIAL_STATE);
  const [restartRequired, setRestartRequired] = useState(false);
  const [pendingAction, setPendingAction] = useState<PermissionSetupAction | null>(
    null,
  );
  const [actionError, setActionError] = useState(false);

  useEffect(() => {
    let active = true;
    const acceptState = (next: PermissionStateSnapshot) => {
      if (!active) return;
      setState((current) =>
        next.revision >= current.revision ? next : current,
      );
    };
    const unsubscribe = window.permissionState.onStateChange(acceptState);
    void window.permissionState.getState().then(acceptState).catch(() => {
      if (active) setActionError(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const model = useMemo(
    () => permissionSetupViewModel(state, restartRequired),
    [state, restartRequired],
  );

  async function runAction(action: PermissionSetupAction) {
    if (pendingAction !== null) return;
    setPendingAction(action);
    setActionError(false);
    try {
      switch (action) {
        case "open_accessibility":
          await window.permissionState.openAccessibilitySettings();
          break;
        case "open_input_monitoring":
          await window.permissionState.openInputMonitoringSettings();
          setRestartRequired(true);
          break;
        case "recheck":
          setState(await window.permissionState.recheck());
          break;
        case "relaunch":
          await window.permissionState.relaunch();
          return;
      }
    } catch {
      setActionError(true);
    } finally {
      setPendingAction(null);
    }
  }

  const isChecking = state.status === "checking" && !restartRequired;

  return (
    <main className={`setup-shell${model.isSuccess ? " setup-shell--success" : ""}`}>
      <header className="setup-header">
        <span className="setup-mark" aria-hidden="true">✦</span>
        <span>AI English Companion</span>
      </header>

      <section className="setup-content" aria-live="polite">
        <h1>{model.title}</h1>
        <p className="setup-explanation">{model.explanation}</p>
        {model.privacy && <p className="setup-privacy">{model.privacy}</p>}

        {model.showPermissionRows !== false && (
          <ol className="permission-list" aria-label="所需权限">
            <PermissionRow
              label="辅助功能"
              detail="识别你主动选中的英文单词"
              state={model.accessibilityRow}
            />
            <PermissionRow
              label="输入监控"
              detail="识别鼠标双击并显示翻译按钮"
              state={model.inputMonitoringRow}
            />
          </ol>
        )}

        {model.fallback && <p className="setup-fallback">{model.fallback}</p>}
        {actionError && (
          <p className="setup-error" role="alert">操作未完成，请重试。</p>
        )}
      </section>

      {(model.primaryAction || model.secondaryAction) && (
        <footer className="setup-actions">
          {model.secondaryAction && model.secondaryLabel && (
            <button
              className="button button--secondary"
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void runAction(model.secondaryAction!)}
            >
              {model.secondaryLabel}
            </button>
          )}
          {model.primaryAction && model.primaryLabel && (
            <button
              className="button button--primary"
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void runAction(model.primaryAction!)}
            >
              {pendingAction === model.primaryAction ? "请稍候…" : model.primaryLabel}
            </button>
          )}
        </footer>
      )}

      {isChecking && <span className="setup-spinner" aria-hidden="true" />}
    </main>
  );
}
