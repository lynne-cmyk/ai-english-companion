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
}
