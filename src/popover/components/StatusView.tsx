import { ErrorIcon, OfflineIcon } from "./Icons";

export function StatusView({
  kind,
  retryDisabled = false,
  onRetry,
}: {
  kind: "error" | "offline";
  retryDisabled?: boolean;
  onRetry: () => void;
}) {
  const isOffline = kind === "offline";

  return (
    <section className="status-surface">
      <div className="status-surface__icon">
        {isOffline ? <OfflineIcon /> : <ErrorIcon />}
      </div>
      <div className="status-surface__copy zh-copy">
        <strong>{isOffline ? "当前离线" : "暂时无法生成解释"}</strong>
        <span>{isOffline ? "联网后可继续生成解释" : "请求失败，请稍后重试"}</span>
      </div>
      <button
        type="button"
        className="retry-button zh-copy"
        disabled={retryDisabled}
        onClick={onRetry}
      >
        重试
      </button>
    </section>
  );
}
