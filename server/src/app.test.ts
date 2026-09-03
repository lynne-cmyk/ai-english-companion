import assert from "node:assert/strict";
import test from "node:test";
import {
  AIProviderError,
  MockAIProvider,
  type AIProvider,
} from "./ai";
import { createApiServer } from "./app";

async function startTestServer(aiProvider: AIProvider = new MockAIProvider()) {
  const server = createApiServer(aiProvider);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Test server did not receive a TCP port");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test("POST /ai/explain returns the Mock Provider result", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/ai/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      word: "component",
      source_app: "Cursor",
      user_goal: "learn English while working",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    word: "component",
    phonetic: "/kəmˈpoʊ.nənt/",
    part_of_speech: "NOUN",
    translation: "组件",
    general_meaning: "构成较大整体的一部分，或系统中的组成元素。",
    context_explanation:
      "你现在在 Cursor 中看到 component，它通常指 React 中可复用的一段 UI 代码。",
    example: "This button is a reusable component.",
  });
});

test("POST /ai/explain returns HTTP 400 when word is missing", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/ai/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_app: "Cursor",
      user_goal: "learn English while working",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "word, source_app, and user_goal are required",
  });
});

test("POST /ai/explain maps an AI timeout to HTTP 504", async (t) => {
  const timeoutProvider: AIProvider = {
    name: "timeout-test",
    async generateExplanation() {
      throw new AIProviderError("TIMEOUT", "Request timed out");
    },
  };
  const { server, baseUrl } = await startTestServer(timeoutProvider);
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/ai/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      word: "component",
      source_app: "Cursor",
      user_goal: "understand_in_context",
    }),
  });

  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), {
    error: "AI provider failed",
    code: "TIMEOUT",
  });
});

test("Provider errors preserve safe codes and expose upstream status only for HTTP errors", async (t) => {
  const cases = [
    { code: "HTTP_ERROR", upstream: 429, status: 502 },
    { code: "HTTP_ERROR", upstream: 504, status: 502 },
    { code: "HTTP_ERROR", upstream: 401, status: 502 },
    { code: "HTTP_ERROR", upstream: 403, status: 502 },
    { code: "HTTP_ERROR", upstream: undefined, status: 502 },
    { code: "NETWORK_ERROR", upstream: undefined, status: 503 },
    { code: "MISSING_API_KEY", upstream: undefined, status: 503 },
    { code: "INVALID_RESPONSE", upstream: undefined, status: 502 },
    { code: "TIMEOUT", upstream: 504, status: 504 },
  ] as const;
  for (const item of cases) {
    await t.test(`${item.code}:${String(item.upstream)}`, async (t) => {
      const provider: AIProvider = {
        name: "failure-test",
        async generateExplanation() {
          throw new AIProviderError(item.code, "private provider details", {
            httpStatus: item.upstream,
            cause: new Error("private stack"),
          });
        },
      };
      const { server, baseUrl } = await startTestServer(provider);
      t.after(() => server.close());
      const response = await fetch(`${baseUrl}/ai/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: "component", source_app: "Cursor", user_goal: "learn" }),
      });
      assert.equal(response.status, item.status);
      assert.deepEqual(await response.json(), {
        error: "AI provider failed",
        code: item.code,
        ...(item.code === "HTTP_ERROR" && item.upstream !== undefined
          ? { upstream_status: item.upstream } : {}),
      });
    });
  }
});
