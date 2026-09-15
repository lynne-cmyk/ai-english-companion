import type { SecretStore } from "../secrets/secretStore";
import { DeepSeekAIProvider } from "../../dist-provider/deepSeekProvider";
import {
  AIProviderError,
  type AIProvider,
} from "../../dist-provider/provider";
import type {
  ExplanationRequestOptions,
  ExplanationResult,
  ExplanationService,
  GenerateExplanationInput,
} from "./contracts";
import { DirectExplanationError } from "./errors";
import { parseExplanationResult } from "./resultValidation";

export { DirectExplanationError } from "./errors";

interface DirectProviderExplanationServiceOptions {
  secretStore: SecretStore;
  providerFactory?: (apiKey: string) => AIProvider;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was aborted", "AbortError");
}

function mapProviderError(error: AIProviderError): DirectExplanationError {
  switch (error.code) {
    case "MISSING_API_KEY":
      return new DirectExplanationError("API_KEY_MISSING", { cause: error });
    case "TIMEOUT":
      return new DirectExplanationError("PROVIDER_TIMEOUT", { cause: error });
    case "NETWORK_ERROR":
      return new DirectExplanationError("PROVIDER_NETWORK_ERROR", { cause: error });
    case "HTTP_ERROR":
      return new DirectExplanationError("UPSTREAM_HTTP_ERROR", {
        cause: error,
        upstreamStatus: error.httpStatus,
      });
    case "INVALID_RESPONSE":
      return new DirectExplanationError("INVALID_RESPONSE", { cause: error });
  }
}

export class DirectProviderExplanationService implements ExplanationService {
  private readonly secretStore: SecretStore;
  private readonly providerFactory: (apiKey: string) => AIProvider;

  constructor(options: DirectProviderExplanationServiceOptions) {
    this.secretStore = options.secretStore;
    this.providerFactory = options.providerFactory ??
      ((apiKey) => new DeepSeekAIProvider({ apiKey }));
  }

  async generateExplanation(
    input: GenerateExplanationInput,
    options: ExplanationRequestOptions = {},
  ): Promise<ExplanationResult> {
    throwIfAborted(options.signal);

    let apiKey: string | null;
    try {
      apiKey = await this.secretStore.getApiKey();
    } catch (error) {
      throw new DirectExplanationError("API_KEY_UNREADABLE", { cause: error });
    }

    throwIfAborted(options.signal);
    if (apiKey === null) throw new DirectExplanationError("API_KEY_MISSING");

    try {
      const provider = this.providerFactory(apiKey);
      const result = await provider.generateExplanation(input, options);
      return parseExplanationResult(result, input.word);
    } catch (error) {
      if (error instanceof AIProviderError) throw mapProviderError(error);
      throw error;
    }
  }
}
