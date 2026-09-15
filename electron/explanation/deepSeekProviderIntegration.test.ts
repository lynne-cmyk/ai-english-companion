import assert from "node:assert/strict";
import test from "node:test";
import {
  DEEPSEEK_SYSTEM_PROMPT,
  DeepSeekAIProvider,
} from "../../dist-provider/deepSeekProvider";
import {
  AIProviderError,
  type AIProviderErrorCode,
} from "../../dist-provider/provider";

const input = {
  word: "component",
  source_app: "Cursor",
  user_goal: "learn English while working",
};

const explanation = {
  word: "component",
  phonetic: "/kəmˈpoʊ.nənt/",
  part_of_speech: "NOUN",
  translation: "组件",
  general_meaning: "构成整体的一部分。",
  context_explanation: "在 Cursor 中通常指可复用的 UI 单元。",
  example: "This button is a reusable component.",
};

function responseFor(value: unknown) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(value) } }],
  });
}

async function expectCode(promise: Promise<unknown>, code: AIProviderErrorCode) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AIProviderError);
    assert.equal(error.code, code);
    return true;
  });
}

test("Direct runtime uses the canonical Provider with an explicit key and no localhost", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const provider = new DeepSeekAIProvider({
    apiKey: "direct-test-key",
    environment: { DEEPSEEK_API_KEY: "environment-test-key" },
    fetchImplementation: async (requestUrl, requestInit) => {
      url = String(requestUrl);
      init = requestInit;
      return responseFor(explanation);
    },
  });

  assert.deepEqual(await provider.generateExplanation(input), explanation);
  assert.equal(url, "https://api.deepseek.com/chat/completions");
  assert.equal(
    new Headers(init?.headers).get("Authorization"),
    "Bearer direct-test-key",
  );
  assert.equal(url.includes("localhost"), false);
  assert.match(DEEPSEEK_SYSTEM_PROMPT, /Simplified Chinese \(zh-CN\)/);
});

test("Direct runtime canonical Provider preserves caller abort", async () => {
  const controller = new AbortController();
  const provider = new DeepSeekAIProvider({
    apiKey: "direct-test-key",
    fetchImplementation: ((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      })) as typeof fetch,
  });

  const pending = provider.generateExplanation(input, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, (error: unknown) =>
    error instanceof Error && error.name === "AbortError");
});

test("Direct runtime canonical Provider classifies timeout and network failure", async () => {
  const timeoutProvider = new DeepSeekAIProvider({
    apiKey: "direct-test-key",
    timeoutMs: 5,
    fetchImplementation: ((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      })) as typeof fetch,
  });
  await expectCode(timeoutProvider.generateExplanation(input), "TIMEOUT");

  const networkProvider = new DeepSeekAIProvider({
    apiKey: "direct-test-key",
    fetchImplementation: async () => {
      throw new TypeError("network failed");
    },
  });
  await expectCode(networkProvider.generateExplanation(input), "NETWORK_ERROR");
});

test("Direct runtime canonical Provider retains only safe HTTP status metadata", async () => {
  for (const status of [401, 403, 429, 503]) {
    const provider = new DeepSeekAIProvider({
      apiKey: "direct-test-key",
      fetchImplementation: async () => new Response(
        JSON.stringify({ error: "sensitive upstream body" }),
        { status },
      ),
    });
    await assert.rejects(provider.generateExplanation(input), (error: unknown) => {
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, "HTTP_ERROR");
      assert.equal(error.httpStatus, status);
      assert.equal(error.message.includes("sensitive upstream body"), false);
      assert.equal(error.message.includes("direct-test-key"), false);
      return true;
    });
  }
});

test("Direct runtime canonical Provider rejects malformed structured results", async () => {
  const responses = [
    new Response("not-json", { status: 200 }),
    Response.json({ choices: [{ message: { content: "not-json" } }] }),
    responseFor({ ...explanation, word: "dependency" }),
    responseFor({ ...explanation, translation: "component" }),
  ];
  for (const response of responses) {
    const provider = new DeepSeekAIProvider({
      apiKey: "direct-test-key",
      fetchImplementation: async () => response,
    });
    await expectCode(provider.generateExplanation(input), "INVALID_RESPONSE");
  }
});
