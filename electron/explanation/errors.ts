export type DirectExplanationErrorCode =
  | "API_KEY_MISSING"
  | "API_KEY_UNREADABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK_ERROR"
  | "UPSTREAM_HTTP_ERROR"
  | "INVALID_RESPONSE";

export class DirectExplanationError extends Error {
  constructor(
    readonly code: DirectExplanationErrorCode,
    options?: { cause?: unknown; upstreamStatus?: number },
  ) {
    super(`Direct explanation failed: ${code}`, { cause: options?.cause });
    this.name = "DirectExplanationError";
    this.upstreamStatus = options?.upstreamStatus;
  }

  readonly upstreamStatus?: number;
}
