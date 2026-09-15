import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BackendHttpError,
  BackendTransportError,
  InvalidExplanationError,
  classifyFailure,
} from "../aiRecovery";
import type { ExplanationService } from "./contracts";
import { HttpExplanationService } from "./httpExplanationService";

const input = {
  word: "component",
  source_app: "Cursor",
  user_goal: "learn English while working",
};

const explanation = {
  word: "component",
  phonetic: "/kəmˈpoʊ.nənt/",
  part_of_speech: "noun",
  translation: "组件",
  general_meaning: "构成更大整体的部分。",
  context_explanation: "在 Cursor 中通常指可复用的 UI 单元。",
  example: "This button is a reusable component.",
};

const repositoryRoot = path.resolve(__dirname, "../..");

test("Electron request lifecycle uses the Direct service boundary and packages its runtime", () => {
  const mainSource = readFileSync(
    path.join(repositoryRoot, "electron/main.ts"),
    "utf8",
  );
  const builderConfig = readFileSync(
    path.join(repositoryRoot, "electron-builder.yml"),
    "utf8",
  );

  assert.match(mainSource, /service\.generateExplanation\(/);
  assert.match(mainSource, /new DirectProviderExplanationService/);
  assert.doesNotMatch(mainSource, /new HttpExplanationService/);
  assert.doesNotMatch(mainSource, /127\.0\.0\.1:3001\/ai\/explain/);
  assert.doesNotMatch(mainSource, /function requestAIExplanation\(/);
  assert.match(builderConfig, /- dist-electron\/explanation\/\*\*\/\*/);
});

test("ExplanationService returns a valid explanation through the HTTP implementation", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;
  const service: ExplanationService = new HttpExplanationService({
    endpoint: "http://127.0.0.1:4567/ai/explain",
    fetchImplementation: async (url, init) => {
      receivedUrl = String(url);
      receivedInit = init;
      return Response.json(explanation);
    },
  });

  const inputWithCallerMetadata = {
    ...input,
    cursorAnchor: { x: 250, y: 110 },
  };

  assert.deepEqual(await service.generateExplanation(inputWithCallerMetadata), {
    ...explanation,
    part_of_speech: "NOUN",
  });
  assert.equal(receivedUrl, "http://127.0.0.1:4567/ai/explain");
  assert.equal(receivedInit?.method, "POST");
  assert.equal(
    new Headers(receivedInit?.headers).get("Content-Type"),
    "application/json",
  );
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), input);
});

test("HttpExplanationService forwards the caller AbortSignal", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;
  const service = new HttpExplanationService({
    fetchImplementation: async (_url, init) => {
      receivedSignal = init?.signal;
      throw new DOMException("Aborted", "AbortError");
    },
  });

  controller.abort();
  await assert.rejects(
    service.generateExplanation(input, { signal: controller.signal }),
    BackendTransportError,
  );
  assert.equal(receivedSignal, controller.signal);
});

test("HttpExplanationService preserves structured Backend failures", async () => {
  const service = new HttpExplanationService({
    fetchImplementation: async () => Response.json({
      error: "AI provider failed",
      code: "HTTP_ERROR",
      upstream_status: 429,
    }, { status: 502 }),
  });

  await assert.rejects(
    service.generateExplanation(input),
    (error: unknown) => {
      assert.ok(error instanceof BackendHttpError);
      assert.equal(error.httpStatus, 502);
      assert.equal(error.providerCode, "HTTP_ERROR");
      assert.equal(error.upstreamStatus, 429);
      assert.deepEqual(classifyFailure(error, false, true), {
        status: "error",
        failure: { code: "UPSTREAM_HTTP_ERROR", retryable: true },
      });
      return true;
    },
  );
});

test("HttpExplanationService keeps connection failures in existing error semantics", async () => {
  const cause = new TypeError("fetch failed", {
    cause: { code: "ECONNREFUSED" },
  });
  const service = new HttpExplanationService({
    fetchImplementation: async () => {
      throw cause;
    },
  });

  await assert.rejects(
    service.generateExplanation(input),
    (error: unknown) => {
      assert.ok(error instanceof BackendTransportError);
      assert.deepEqual(classifyFailure(error, false, false), {
        status: "error",
        failure: { code: "BACKEND_UNAVAILABLE", retryable: true },
      });
      return true;
    },
  );
});

test("HttpExplanationService rejects malformed, mismatched, and invalid responses", async () => {
  const responses = [
    new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    Response.json({ ...explanation, word: "dependency" }),
    Response.json({ word: "component" }),
  ];

  for (const response of responses) {
    const service = new HttpExplanationService({
      fetchImplementation: async () => response,
    });
    await assert.rejects(
      service.generateExplanation(input),
      InvalidExplanationError,
    );
  }
});
