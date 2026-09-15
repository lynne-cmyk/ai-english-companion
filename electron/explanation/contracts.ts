export interface GenerateExplanationInput {
  word: string;
  source_app: string;
  user_goal: string;
}

export interface ExplanationResult {
  word: string;
  phonetic: string;
  translation: string;
  general_meaning: string;
  context_explanation: string;
  example: string;
  part_of_speech?: string;
}

export interface ExplanationRequestOptions {
  signal?: AbortSignal;
}

export interface ExplanationService {
  generateExplanation(
    input: GenerateExplanationInput,
    options?: ExplanationRequestOptions,
  ): Promise<ExplanationResult>;
}
