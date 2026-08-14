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
