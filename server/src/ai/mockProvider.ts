import type { AIProvider } from "./provider";
import type {
  ExplanationResult,
  GenerateExplanationInput,
} from "./types";

const mockExplanation: ExplanationResult = {
  word: "component",
  phonetic: "/kəmˈpoʊ.nənt/",
  translation: "组件",
  general_meaning: "构成较大整体的一部分，或系统中的组成元素。",
  context_explanation:
    "你现在在 Cursor 中看到 component，它通常指 React 中可复用的一段 UI 代码。",
  example: "This button is a reusable component.",
};

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateExplanation(
    _input: GenerateExplanationInput,
  ): Promise<ExplanationResult> {
    return { ...mockExplanation };
  }
}
