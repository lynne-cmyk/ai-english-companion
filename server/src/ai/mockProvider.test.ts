import assert from "node:assert/strict";
import test from "node:test";
import { MockAIProvider } from "./mockProvider";

const expectedCommonFields = {
  phonetic: "/mock/",
  translation: "测试释义",
  general_meaning:
    "这是 Mock Provider 返回的测试含义，不代表真实词典解释。",
};

test("MockAIProvider returns the exact requested word", async () => {
  const provider = new MockAIProvider();

  for (const word of ["component", "Markdown", "Architecture"]) {
    const result = await provider.generateExplanation({
      word,
      source_app: "Google Chrome",
      user_goal: "understand_in_context",
    });

    assert.equal(result.word, word);
    assert.equal(result.phonetic, expectedCommonFields.phonetic);
    assert.equal(result.translation, expectedCommonFields.translation);
    assert.equal(result.general_meaning, expectedCommonFields.general_meaning);
    assert.equal(result.part_of_speech, undefined);
    assert.equal(result.example, `Mock response for "${word}".`);
  }
});

test("MockAIProvider preserves case and reflects the source app in context", async () => {
  const provider = new MockAIProvider();
  const result = await provider.generateExplanation({
    word: "Markdown",
    source_app: "文本编辑",
    user_goal: "understand_in_context",
  });

  assert.equal(result.word, "Markdown");
  assert.equal(
    result.context_explanation,
    "你现在在 文本编辑 中看到 Markdown。这是 Mock Provider 返回的测试解释，用于验证跨 App 翻译流程。",
  );
  assert.equal(result.context_explanation.includes("Cursor"), false);
  assert.notEqual(String(result.word), "component");
});
