import type {
  ExplanationResult,
  GenerateExplanationInput,
} from "./types";

export interface AIProvider {
  readonly name: string;

  generateExplanation(
    input: GenerateExplanationInput,
  ): Promise<ExplanationResult>;
}

export type AIProviderErrorCode =
  | "MISSING_API_KEY"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export class AIProviderError extends Error {
  constructor(
    readonly code: AIProviderErrorCode,
    message: string,
    options?: { cause?: unknown; httpStatus?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AIProviderError";
    this.httpStatus = options?.httpStatus;
  }

  readonly httpStatus?: number;
}
