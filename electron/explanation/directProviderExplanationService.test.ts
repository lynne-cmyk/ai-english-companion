import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AIProviderError, type AIProvider } from "../../dist-provider/provider";
import { classifyFailure } from "../aiRecovery";
import type { SecretStore } from "../secrets/secretStore";
import type { ExplanationResult } from "./contracts";
import {
  DirectExplanationError,
  DirectProviderExplanationService,
} from "./directProviderExplanationService";

const input = {
  word: "component",
  source_app: "Cursor",
  user_goal: "learn English while working",
};

const explanation: ExplanationResult = {
  word: "component",
  phonetic: "/kəmˈpoʊ.nənt/",
  part_of_speech: "NOUN",
  translation: "组件",
  general_meaning: "构成整体的一部分。",
  context_explanation: "在 Cursor 中通常指可复用的 UI 单元。",
  example: "This button is a reusable component.",
};

class TestSecretStore implements SecretStore {
  key: string | null = "test-direct-key";
  readError: Error | null = null;

  async isConfigured() { return this.key !== null; }
  async setApiKey(apiKey: string) { this.key = apiKey; }
  async deleteApiKey() { this.key = null; }
  async getApiKey() {
    if (this.readError !== null) throw this.readError;
    return this.key;
  }
}

function provider(
  generate: AIProvider["generateExplanation"] = async () => explanation,
): AIProvider {
  return { name: "test", generateExplanation: generate };
}

test("configured SecretStore key is injected and a valid result is normalized", async () => {
  const store = new TestSecretStore();
  const receivedKeys: string[] = [];
  const service = new DirectProviderExplanationService({
    secretStore: store,
    providerFactory: (apiKey) => {
      receivedKeys.push(apiKey);
      return provider(async () => ({ ...explanation, part_of_speech: "noun" }));
    },
  });

  assert.deepEqual(await service.generateExplanation(input), explanation);
  assert.deepEqual(receivedKeys, ["test-direct-key"]);
});

test("missing and unreadable keys fail safely before Provider creation", async () => {
  for (const mode of ["missing", "unreadable"] as const) {
    const store = new TestSecretStore();
    if (mode === "missing") store.key = null;
    else store.readError = new Error("encrypted value cannot be read");
    let providerCreations = 0;
    const service = new DirectProviderExplanationService({
      secretStore: store,
      providerFactory: () => {
        providerCreations++;
        return provider();
      },
    });

    await assert.rejects(service.generateExplanation(input), (error: unknown) => {
      assert.ok(error instanceof DirectExplanationError);
      assert.equal(
        error.code,
        mode === "missing" ? "API_KEY_MISSING" : "API_KEY_UNREADABLE",
      );
      assert.equal(error.message.includes("test-direct-key"), false);
      return true;
    });
    assert.equal(providerCreations, 0);
  }
});

test("caller AbortSignal is forwarded without changing its cancellation identity", async () => {
  const store = new TestSecretStore();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let markProviderStarted: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve;
  });
  const service = new DirectProviderExplanationService({
    secretStore: store,
    providerFactory: () => provider(async (_input, options) => {
      receivedSignal = options?.signal;
      markProviderStarted?.();
      return new Promise<ExplanationResult>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        });
      });
    }),
  });

  const pending = service.generateExplanation(input, { signal: controller.signal });
  await providerStarted;
  controller.abort(new DOMException("superseded", "AbortError"));
  await assert.rejects(pending, (error: unknown) =>
    error instanceof Error && error.name === "AbortError");
  assert.equal(receivedSignal, controller.signal);
});

test("each request rereads SecretStore so Retry-compatible calls use a replaced key", async () => {
  const store = new TestSecretStore();
  const receivedKeys: string[] = [];
  const service = new DirectProviderExplanationService({
    secretStore: store,
    providerFactory: (apiKey) => {
      receivedKeys.push(apiKey);
      return provider();
    },
  });

  await service.generateExplanation(input);
  store.key = "replacement-key";
  await service.generateExplanation(input);
  assert.deepEqual(receivedKeys, ["test-direct-key", "replacement-key"]);
});

test("Provider failures map to safe existing recovery semantics", async () => {
  const cases = [
    [new AIProviderError("TIMEOUT", "timeout"), "PROVIDER_TIMEOUT", true, "error"],
    [new AIProviderError("NETWORK_ERROR", "network"), "PROVIDER_NETWORK_ERROR", true, "offline"],
    [new AIProviderError("HTTP_ERROR", "auth", { httpStatus: 401 }), "UPSTREAM_HTTP_ERROR", false, "error"],
    [new AIProviderError("HTTP_ERROR", "permission", { httpStatus: 403 }), "UPSTREAM_HTTP_ERROR", false, "error"],
    [new AIProviderError("HTTP_ERROR", "rate", { httpStatus: 429 }), "UPSTREAM_HTTP_ERROR", true, "error"],
    [new AIProviderError("HTTP_ERROR", "upstream", { httpStatus: 503 }), "UPSTREAM_HTTP_ERROR", true, "error"],
    [new AIProviderError("INVALID_RESPONSE", "invalid"), "INVALID_RESPONSE", true, "error"],
  ] as const;

  for (const [providerError, code, retryable, offlineStatus] of cases) {
    const service = new DirectProviderExplanationService({
      secretStore: new TestSecretStore(),
      providerFactory: () => provider(async () => { throw providerError; }),
    });
    await assert.rejects(service.generateExplanation(input), (error: unknown) => {
      const classified = classifyFailure(error, false, false);
      assert.equal(classified.failure.code, code);
      assert.equal(classified.failure.retryable, retryable);
      assert.equal(classified.status, offlineStatus);
      return true;
    });
  }
});

test("Direct production construction has no localhost or environment secret fallback", () => {
  const repositoryRoot = path.resolve(__dirname, "../..");
  const mainSource = readFileSync(path.join(repositoryRoot, "electron/main.ts"), "utf8");
  const serviceSource = readFileSync(
    path.join(repositoryRoot, "electron/explanation/directProviderExplanationService.ts"),
    "utf8",
  );

  assert.match(mainSource, /new DirectProviderExplanationService/);
  assert.doesNotMatch(mainSource, /new HttpExplanationService/);
  assert.doesNotMatch(serviceSource, /127\.0\.0\.1|localhost|process\.env|DEEPSEEK_API_KEY/);
});
