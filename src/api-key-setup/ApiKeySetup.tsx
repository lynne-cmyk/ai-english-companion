import { useEffect, useState } from "react";
import type {
  ApiKeySetupErrorCode,
  ApiKeySetupState,
} from "../../electron/secrets/contracts";

const INITIAL_STATE: ApiKeySetupState = {
  status: "ready",
  configured: false,
};

const errorCopy: Record<ApiKeySetupErrorCode, string> = {
  invalid_api_key: "请输入有效的 API Key。",
  encryption_unavailable: "macOS 安全存储当前不可用，请稍后重试。",
  storage_unavailable: "无法保存本机设置，请稍后重试。",
  stored_key_unreadable: "已保存的 API Key 无法读取，请删除后重新设置。",
};

export function ApiKeySetup() {
  const [state, setState] = useState<ApiKeySetupState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<"save" | "delete" | null>(null);

  useEffect(() => {
    let active = true;
    void window.apiKeySetup.getState().then((next) => {
      if (active) setState(next);
    }).catch(() => {
      if (active) {
        setState({
          status: "error",
          configured: false,
          error: "storage_unavailable",
        });
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const showInput = !state.configured || editing;

  async function save() {
    if (pending !== null) return;
    setPending("save");
    try {
      const result = await window.apiKeySetup.setApiKey(apiKey);
      setState(result.state);
      if (result.ok) {
        setApiKey("");
        setEditing(false);
      }
    } catch {
      setState({
        status: "error",
        configured: false,
        error: "storage_unavailable",
      });
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (pending !== null) return;
    setPending("delete");
    try {
      const result = await window.apiKeySetup.deleteApiKey();
      setState(result.state);
      if (result.ok) {
        setApiKey("");
        setEditing(false);
      }
    } catch {
      setState({
        status: "error",
        configured: false,
        error: "storage_unavailable",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="key-setup-shell">
      <header className="key-setup-header">
        <span aria-hidden="true">✦</span>
        <span>Tirva</span>
      </header>

      <section className="key-setup-content" aria-live="polite">
        <h1>{state.configured ? "API Key 已配置" : "配置 DeepSeek API Key"}</h1>
        <p className="key-setup-explanation">
          {state.configured
            ? "密钥已安全保存在这台 Mac 上，不会显示或返回给页面。"
            : "使用你自己的 DeepSeek API Key。密钥将通过 macOS 安全存储加密后保存在本机。"}
        </p>

        {showInput && !loading && (
          <label className="key-field">
            <span>DeepSeek API Key</span>
            <input
              type="password"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder="输入 API Key"
              disabled={pending !== null}
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
            />
          </label>
        )}

        {state.status === "error" && (
          <p className="key-setup-error" role="alert">
            {errorCopy[state.error]}
          </p>
        )}
      </section>

      <footer className="key-setup-actions">
        {state.configured && !editing && (
          <button
            className="key-button key-button--secondary"
            type="button"
            disabled={pending !== null}
            onClick={() => setEditing(true)}
          >
            替换
          </button>
        )}
        {(state.configured || state.status === "error") && (
          <button
            className="key-button key-button--secondary"
            type="button"
            disabled={pending !== null}
            onClick={() => void remove()}
          >
            {pending === "delete" ? "正在删除…" : "删除"}
          </button>
        )}
        {showInput && !loading && (
          <button
            className="key-button key-button--primary"
            type="button"
            disabled={pending !== null || apiKey.trim() === ""}
            onClick={() => void save()}
          >
            {pending === "save" ? "正在保存…" : "保存"}
          </button>
        )}
      </footer>
    </main>
  );
}
