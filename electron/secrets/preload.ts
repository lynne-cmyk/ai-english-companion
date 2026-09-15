import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiKeySetupBridge,
  ApiKeySetupResult,
  ApiKeySetupState,
} from "./contracts";

// Sandboxed preloads cannot require local CommonJS modules. Keep runtime
// channel values local while sharing compile-time types with the main process.
const channels = {
  getState: "api-key-setup:get-state",
  setApiKey: "api-key-setup:set-api-key",
  deleteApiKey: "api-key-setup:delete-api-key",
} as const;

const errorCodes = new Set([
  "invalid_api_key",
  "encryption_unavailable",
  "storage_unavailable",
  "stored_key_unreadable",
]);

function isState(value: unknown): value is ApiKeySetupState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ApiKeySetupState>;
  if (state.status === "ready") return typeof state.configured === "boolean";
  return (
    state.status === "error" &&
    state.configured === false &&
    typeof state.error === "string" &&
    errorCodes.has(state.error)
  );
}

function isResult(value: unknown): value is ApiKeySetupResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ApiKeySetupResult>;
  return typeof result.ok === "boolean" && isState(result.state);
}

async function getState() {
  const value: unknown = await ipcRenderer.invoke(channels.getState);
  if (!isState(value)) throw new Error("Invalid API key setup state response");
  return value;
}

async function runAction(channel: string, apiKey?: string) {
  const value: unknown = await ipcRenderer.invoke(channel, apiKey);
  if (!isResult(value)) throw new Error("Invalid API key setup action response");
  return value;
}

const bridge: ApiKeySetupBridge = {
  getState,
  setApiKey: (apiKey) => runAction(channels.setApiKey, apiKey),
  deleteApiKey: () => runAction(channels.deleteApiKey),
};

contextBridge.exposeInMainWorld("apiKeySetup", bridge);
