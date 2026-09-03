import assert from "node:assert/strict";
import test from "node:test";
import {
  DEEPSEEK_SYSTEM_PROMPT,
  DeepSeekAIProvider,
} from "./deepSeekProvider";
import { AIProviderError, type AIProviderErrorCode } from "./provider";

const input = {
  word: "dependency",
  source_app: "Cursor",
  user_goal: "understand_in_context",
};

const explanation = {
  word: "dependency",
  phonetic: "/dɪˈpendənsi/",
  part_of_speech: "NOUN",
  translation: "依赖；依赖项",
  general_meaning: "指对某人或某事物的依赖。",
  context_explanation: "在 Cursor 中，它通常指项目依赖的软件包。",
  example: "Install the project dependencies first.",
};

function chatCompletionResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

async function expectProviderError(
  promise: Promise<unknown>,
  expectedCode: AIProviderErrorCode,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AIProviderError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test("DeepSeekAIProvider builds the expected request and validates the result", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;

  const fetchImplementation: typeof fetch = async (url, init) => {
    receivedUrl = String(url);
    receivedInit = init;
    return chatCompletionResponse(JSON.stringify(explanation));
  };

  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
  });

  assert.deepEqual(await provider.generateExplanation(input), explanation);
  assert.equal(receivedUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(new Headers(receivedInit?.headers).get("Authorization"), "Bearer test-api-key");

  const requestBody = JSON.parse(String(receivedInit?.body)) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format: { type: string };
  };

  assert.equal(requestBody.model, "deepseek-v4-flash");
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.equal(requestBody.messages[0]?.content, DEEPSEEK_SYSTEM_PROMPT);
  assert.match(DEEPSEEK_SYSTEM_PROMPT, /Simplified Chinese \(zh-CN\) lexical meaning/);
  assert.match(DEEPSEEK_SYSTEM_PROMPT, /must not be English-only, empty, or whitespace-only/);
  assert.deepEqual(JSON.parse(requestBody.messages[1]?.content ?? ""), input);
});

for (const translation of [
  "组件",
  "React 组件",
  "Kubernetes（容器编排平台）",
  "Git 分支",
  "React 19 组件（UI）",
  "  组件 \t",
  "組件",
]) {
  test(`DeepSeekAIProvider preserves an accepted translation: ${JSON.stringify(translation)}`, async () => {
    const expectedResult = { ...explanation, translation };
    const provider = new DeepSeekAIProvider({
      environment: { DEEPSEEK_API_KEY: "test-api-key" },
      fetchImplementation: async () =>
        chatCompletionResponse(JSON.stringify(expectedResult)),
    });

    // Includes whitespace and Traditional Han to guard against mutation/conversion.
    assert.deepEqual(await provider.generateExplanation(input), expectedResult);
  });
}

for (const translation of ["component", "frontend framework", "", " \t\n "]) {
  test(`DeepSeekAIProvider rejects an invalid translation: ${JSON.stringify(translation)}`, async () => {
    const provider = new DeepSeekAIProvider({
      environment: { DEEPSEEK_API_KEY: "test-api-key" },
      fetchImplementation: async () =>
        chatCompletionResponse(JSON.stringify({ ...explanation, translation })),
    });

    await expectProviderError(provider.generateExplanation(input), "INVALID_RESPONSE");
  });
}

test("DeepSeekAIProvider rejects a missing API key without making a request", async () => {
  let requestWasMade = false;
  const fetchImplementation = (async () => {
    requestWasMade = true;
    return chatCompletionResponse(JSON.stringify(explanation));
  }) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: {},
    fetchImplementation,
  });

  await expectProviderError(
    provider.generateExplanation(input),
    "MISSING_API_KEY",
  );
  assert.equal(requestWasMade, false);
});

test("DeepSeekAIProvider reports network failures", async () => {
  const fetchImplementation = (async () => {
    throw new TypeError("Network unavailable");
  }) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
  });

  await expectProviderError(
    provider.generateExplanation(input),
    "NETWORK_ERROR",
  );
});

test("DeepSeekAIProvider aborts requests that time out", async () => {
  const fetchImplementation = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    })) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
    timeoutMs: 10,
  });

  await expectProviderError(provider.generateExplanation(input), "TIMEOUT");
});

test("DeepSeekAIProvider handles a timeout while reading the response body", async () => {
  const fetchImplementation = (async (_url: unknown, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise<unknown>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
  })) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
    timeoutMs: 10,
  });

  await expectProviderError(provider.generateExplanation(input), "TIMEOUT");
});

test("DeepSeekAIProvider reports non-success HTTP responses", async () => {
  const fetchImplementation = (async () =>
    new Response("Rate limited", { status: 429 })) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
  });

  await expectProviderError(provider.generateExplanation(input), "HTTP_ERROR");
});

test("DeepSeekAIProvider rejects invalid JSON content", async () => {
  const fetchImplementation = (async () =>
    chatCompletionResponse("not-json")) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
  });

  await expectProviderError(
    provider.generateExplanation(input),
    "INVALID_RESPONSE",
  );
});

test("DeepSeekAIProvider rejects JSON missing a required field", async () => {
  const { general_meaning: _generalMeaning, ...incompleteExplanation } = explanation;
  const fetchImplementation = (async () =>
    chatCompletionResponse(JSON.stringify(incompleteExplanation))) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
  });

  await expectProviderError(
    provider.generateExplanation(input),
    "INVALID_RESPONSE",
  );
});

test("DeepSeekAIProvider normalizes a supported part of speech", async () => {
  const fetchImplementation = (async () =>
    chatCompletionResponse(
      JSON.stringify({ ...explanation, part_of_speech: "adjective" }),
    )) as typeof fetch;
  const provider = new DeepSeekAIProvider({
    environment: { DEEPSEEK_API_KEY: "test-api-key" },
    fetchImplementation,
  });

  assert.equal(
    (await provider.generateExplanation(input)).part_of_speech,
    "ADJ",
  );
});

test("DeepSeekAIProvider omits an absent or invalid part of speech", async () => {
  const { part_of_speech: _partOfSpeech, ...withoutPartOfSpeech } = explanation;
  const responses = [
    withoutPartOfSpeech,
    { ...explanation, part_of_speech: "unknown category" },
  ];

  for (const response of responses) {
    const provider = new DeepSeekAIProvider({
      environment: { DEEPSEEK_API_KEY: "test-api-key" },
      fetchImplementation: (async () =>
        chatCompletionResponse(JSON.stringify(response))) as typeof fetch,
    });

    assert.equal(
      (await provider.generateExplanation(input)).part_of_speech,
      undefined,
    );
  }
});
