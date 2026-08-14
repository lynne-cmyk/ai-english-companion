import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekAIProvider } from "./deepSeekProvider";
import { MockAIProvider } from "./mockProvider";
import { createAIProvider } from "./providerFactory";

test("createAIProvider uses MockAIProvider by default", () => {
  assert.ok(createAIProvider({}) instanceof MockAIProvider);
});

test("createAIProvider selects DeepSeekAIProvider", () => {
  assert.ok(
    createAIProvider({ AI_PROVIDER: "deepseek" }) instanceof DeepSeekAIProvider,
  );
});

test("createAIProvider rejects unsupported provider names", () => {
  assert.throws(
    () => createAIProvider({ AI_PROVIDER: "unsupported" }),
    /Unsupported AI_PROVIDER/,
  );
});
