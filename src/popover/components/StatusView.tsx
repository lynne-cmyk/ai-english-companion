import { ErrorIcon, OfflineIcon } from "./Icons";

export function StatusView({
  kind,
  failureCode,
  retryDisabled = false,
  onRetry,
}: {
  kind: "error" | "offline";
  failureCode?: string;
  retryDisabled?: boolean;
  onRetry: () => void;
}) {
  const isOffline = kind === "offline";
  const needsApiKey = failureCode === "API_KEY_MISSING";
  const unreadableApiKey = failureCode === "API_KEY_UNREADABLE";
  const title = isOffline
    ? "当前离线"
    : needsApiKey
      ? "请先配置 AI 服务"
      : unreadableApiKey
        ? "AI 服务配置不可用"
        : "暂时无法生成解释";
  const description = isOffline
    ? "联网后可继续生成解释"
    : needsApiKey
      ? "请从菜单栏打开 AI 服务设置"
      : unreadableApiKey
        ? "请删除后重新配置 API Key"
        : "请求失败，请稍后重试";

  return (
    <section className="status-surface">
      <div className="status-surface__icon">
        {isOffline ? <OfflineIcon /> : <ErrorIcon />}
      </div>
      <div className="status-surface__copy zh-copy">
        <strong>{title}</strong>
        <span>{description}</span>
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
