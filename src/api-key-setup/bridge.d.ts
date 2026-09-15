import type { ApiKeySetupBridge } from "../../electron/secrets/contracts";

declare global {
  interface Window {
    apiKeySetup: ApiKeySetupBridge;
  }
}

export {};
