import type { AIProvider } from "./provider";
import type {
  ExplanationResult,
  GenerateExplanationInput,
} from "./types";

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateExplanation(
    input: GenerateExplanationInput,
  ): Promise<ExplanationResult> {
    return {
      word: input.word,
      phonetic: "/mock/",
      translation: "测试释义",
      general_meaning:
        "这是 Mock Provider 返回的测试含义，不代表真实词典解释。",
      context_explanation: `你现在在 ${input.source_app} 中看到 ${input.word}。这是 Mock Provider 返回的测试解释，用于验证跨 App 翻译流程。`,
      example: `Mock response for "${input.word}".`,
    };
  }
}
