import assert from "node:assert/strict";
import test from "node:test";
import { MockAIProvider } from "./mockProvider";

test("MockAIProvider returns the fixed explanation JSON", async () => {
  const provider = new MockAIProvider();
  const result = await provider.generateExplanation({
    word: "component",
    source_app: "Cursor",
    user_goal: "understand_in_context",
  });

  assert.deepEqual(result, {
    word: "component",
    phonetic: "/kəmˈpoʊ.nənt/",
    translation: "组件",
    general_meaning: "构成较大整体的一部分，或系统中的组成元素。",
    context_explanation:
      "你现在在 Cursor 中看到 component，它通常指 React 中可复用的一段 UI 代码。",
    example: "This button is a reusable component.",
  });
});
