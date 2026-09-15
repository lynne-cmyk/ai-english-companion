import {
  BackendTransportError,
  InvalidExplanationError,
  readBackendFailure,
} from "../aiRecovery";
import type {
  ExplanationRequestOptions,
  ExplanationResult,
  ExplanationService,
  GenerateExplanationInput,
} from "./contracts";
import { parseExplanationResult } from "./resultValidation";

const DEFAULT_BACKEND_EXPLAIN_URL =
  "http://127.0.0.1:3001/ai/explain";

interface HttpExplanationServiceOptions {
  endpoint?: string;
  fetchImplementation?: typeof fetch;
}

export class HttpExplanationService implements ExplanationService {
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: HttpExplanationServiceOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_BACKEND_EXPLAIN_URL;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async generateExplanation(
    input: GenerateExplanationInput,
    options: ExplanationRequestOptions = {},
  ): Promise<ExplanationResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: input.word,
          source_app: input.source_app,
          user_goal: input.user_goal,
        }),
        signal: options.signal,
      });
    } catch (error) {
      throw new BackendTransportError(error);
    }

    if (!response.ok) {
      throw await readBackendFailure(response);
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidExplanationError();
      }
      throw new BackendTransportError(error);
    }

    return parseExplanationResult(result, input.word);
  }
}
