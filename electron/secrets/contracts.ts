export const API_KEY_SETUP_CHANNELS = {
  getState: "api-key-setup:get-state",
  setApiKey: "api-key-setup:set-api-key",
  deleteApiKey: "api-key-setup:delete-api-key",
} as const;

export type ApiKeySetupErrorCode =
  | "invalid_api_key"
  | "encryption_unavailable"
  | "storage_unavailable"
  | "stored_key_unreadable";

export type ApiKeySetupState =
  | {
      status: "ready";
      configured: boolean;
    }
  | {
      status: "error";
      configured: false;
      error: ApiKeySetupErrorCode;
    };

export type ApiKeySetupResult =
  | {
      ok: true;
      state: ApiKeySetupState;
    }
  | {
      ok: false;
      state: ApiKeySetupState;
    };

export interface ApiKeySetupBridge {
  getState(): Promise<ApiKeySetupState>;
  setApiKey(apiKey: string): Promise<ApiKeySetupResult>;
  deleteApiKey(): Promise<ApiKeySetupResult>;
}
