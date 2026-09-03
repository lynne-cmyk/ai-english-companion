import assert from "node:assert/strict";
import test from "node:test";
import {
  BackendHttpError, BackendTransportError, InvalidExplanationError,
  classifyFailure, readBackendFailure,
} from "./aiRecovery";

test("structured Provider failures retain classification and safe retryability", () => {
  const cases = [
    ["TIMEOUT", 504, undefined, "PROVIDER_TIMEOUT", true],
    ["INVALID_RESPONSE", 502, undefined, "INVALID_RESPONSE", true],
    ["MISSING_API_KEY", 503, undefined, "MISSING_API_KEY", false],
    ["HTTP_ERROR", 502, 429, "UPSTREAM_HTTP_ERROR", true],
    ["HTTP_ERROR", 502, 504, "UPSTREAM_HTTP_ERROR", true],
    ["HTTP_ERROR", 502, 401, "UPSTREAM_HTTP_ERROR", false],
    ["HTTP_ERROR", 502, 402, "UPSTREAM_HTTP_ERROR", false],
    ["HTTP_ERROR", 502, 403, "UPSTREAM_HTTP_ERROR", false],
    ["HTTP_ERROR", 502, undefined, "UPSTREAM_HTTP_ERROR", true],
  ] as const;
  for (const [providerCode, status, upstream, code, retryable] of cases) {
    assert.deepEqual(classifyFailure(new BackendHttpError(status, providerCode, upstream), false, false), {
      status: "error", failure: { code, retryable },
    });
  }
});

test("only network-related errors with confirmed device offline become Offline", () => {
  for (const online of [true, undefined, false]) {
    for (const error of [
      new BackendHttpError(503, "NETWORK_ERROR"),
      new BackendTransportError(new TypeError("fetch failed")),
    ]) {
      const result = classifyFailure(error, false, online);
      assert.equal(result.status, online === false ? "offline" : "error");
      assert.equal(result.failure.retryable, true);
    }
  }
  const refusal = new BackendTransportError(new TypeError("fetch failed", {
    cause: { code: "ECONNREFUSED" },
  }));
  assert.deepEqual(classifyFailure(refusal, false, false), {
    status: "error", failure: { code: "BACKEND_UNAVAILABLE", retryable: true },
  });
  assert.equal(classifyFailure(new Error("uncertain"), false, false).status, "error");
});

test("local timeout, invalid response, and validation failures stay Error", () => {
  assert.deepEqual(classifyFailure(new Error("aborted"), true, false), {
    status: "error", failure: { code: "CLIENT_TIMEOUT", retryable: true },
  });
  assert.equal(classifyFailure(new InvalidExplanationError(), false, false).failure.code, "INVALID_RESPONSE");
  assert.deepEqual(classifyFailure(new BackendHttpError(400), false, false), {
    status: "error", failure: { code: "INVALID_REQUEST", retryable: false },
  });
});

test("Backend error parsing keeps only known code and optional numeric upstream status", async () => {
  const error = await readBackendFailure(Response.json({
    error: "sensitive body", code: "HTTP_ERROR", upstream_status: 429,
    stack: "private stack", apiKey: "not-a-real-key",
  }, { status: 502 }));
  assert.equal(error.providerCode, "HTTP_ERROR");
  assert.equal(error.upstreamStatus, 429);
  assert.equal(error.message, "Backend returned HTTP 502");
  assert.equal(JSON.stringify(error).includes("sensitive"), false);
  const unknown = await readBackendFailure(Response.json({ code: "unexpected", upstream_status: 401 }, { status: 500 }));
  assert.equal(unknown.providerCode, undefined);
  assert.equal(unknown.upstreamStatus, undefined);
  const malformed = await readBackendFailure(new Response("not json", { status: 503 }));
  assert.equal(malformed.httpStatus, 503);
  const invalidStatus = await readBackendFailure(Response.json({ code: "HTTP_ERROR", upstream_status: "401" }, { status: 502 }));
  assert.equal(invalidStatus.upstreamStatus, undefined);
});
