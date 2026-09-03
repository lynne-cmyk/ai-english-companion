export type FailureCode =
  | "PROVIDER_TIMEOUT"
  | "CLIENT_TIMEOUT"
  | "UPSTREAM_HTTP_ERROR"
  | "PROVIDER_NETWORK_ERROR"
  | "BACKEND_UNAVAILABLE"
  | "BACKEND_NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "MISSING_API_KEY"
  | "INVALID_REQUEST"
  | "BACKEND_HTTP_ERROR"
  | "UNKNOWN";

export interface FailureInfo {
  code: FailureCode;
  retryable: boolean;
}

export interface RequestSnapshot {
  readonly word: string;
  readonly source_app: string;
  readonly user_goal: string;
  readonly cursorAnchor: Readonly<{ x: number; y: number }>;
}

const providerCodes = new Set([
  "TIMEOUT", "HTTP_ERROR", "NETWORK_ERROR", "INVALID_RESPONSE", "MISSING_API_KEY",
]);

export class BackendHttpError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly providerCode?: string,
    readonly upstreamStatus?: number,
  ) {
    super(`Backend returned HTTP ${httpStatus}`);
  }
}

export class BackendTransportError extends Error {
  constructor(cause: unknown) {
    super("Backend transport failed", { cause });
  }
}

export class InvalidExplanationError extends Error {
  constructor() {
    super("Backend returned an invalid explanation result");
  }
}

// Keep only allowlisted metadata. Never forward raw provider bodies or messages.
export async function readBackendFailure(response: Response): Promise<BackendHttpError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new BackendHttpError(response.status);
  }
  const record = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const code = typeof record.code === "string" && providerCodes.has(record.code)
    ? record.code : undefined;
  const upstreamStatus = code === "HTTP_ERROR" &&
    typeof record.upstream_status === "number" &&
    Number.isInteger(record.upstream_status) &&
    record.upstream_status >= 400 && record.upstream_status <= 599
    ? record.upstream_status : undefined;
  return new BackendHttpError(response.status, code, upstreamStatus);
}

function hasConnectionRefused(error: unknown, depth = 0): boolean {
  if (depth > 3 || typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; cause?: unknown; errors?: unknown };
  return record.code === "ECONNREFUSED" ||
    hasConnectionRefused(record.cause, depth + 1) ||
    (Array.isArray(record.errors) && record.errors.some((item) =>
      hasConnectionRefused(item, depth + 1)));
}

function retryableHttp(status: number | undefined): boolean {
  // Unknown upstream status is backward compatible with older Backend responses.
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export function classifyFailure(
  error: unknown,
  timedOut: boolean,
  deviceOnline: boolean | undefined,
): { status: "error" | "offline"; failure: FailureInfo } {
  const result = (code: FailureCode, retryable = true, networkRelated = false) => ({
    status: networkRelated && deviceOnline === false ? "offline" as const : "error" as const,
    failure: { code, retryable },
  });

  // Timeouts are distinct from network unavailability, even when offline too.
  if (timedOut) return result("CLIENT_TIMEOUT");
  if (error instanceof BackendHttpError) {
    switch (error.providerCode) {
      case "TIMEOUT": return result("PROVIDER_TIMEOUT");
      case "HTTP_ERROR": return result("UPSTREAM_HTTP_ERROR", retryableHttp(error.upstreamStatus));
      case "NETWORK_ERROR": return result("PROVIDER_NETWORK_ERROR", true, true);
      case "INVALID_RESPONSE": return result("INVALID_RESPONSE");
      case "MISSING_API_KEY": return result("MISSING_API_KEY", false);
    }
    if (error.httpStatus === 400 || error.httpStatus === 422) {
      return result("INVALID_REQUEST", false);
    }
    return result("BACKEND_HTTP_ERROR", retryableHttp(error.httpStatus));
  }
  if (error instanceof InvalidExplanationError) return result("INVALID_RESPONSE");
  if (error instanceof BackendTransportError) {
    // A stopped loopback server is not evidence of device-level offline status.
    if (hasConnectionRefused(error)) return result("BACKEND_UNAVAILABLE");
    return result("BACKEND_NETWORK_ERROR", true, true);
  }
  return result("UNKNOWN");
}
