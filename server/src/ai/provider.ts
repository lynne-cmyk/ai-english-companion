import type {
  ExplanationResult,
  GenerateExplanationInput,
} from "./types";

export interface AIProvider {
  readonly name: string;

  generateExplanation(
    input: GenerateExplanationInput,
  ): Promise<ExplanationResult>;
}
