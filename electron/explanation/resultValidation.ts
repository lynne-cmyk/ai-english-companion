import { InvalidExplanationError } from "../aiRecovery";
import type { ExplanationResult } from "./contracts";

const PART_OF_SPEECH_LABELS = new Set([
  "NOUN",
  "VERB",
  "ADJ",
  "ADV",
  "PREP",
  "PRON",
  "CONJ",
  "DET",
  "ART",
  "INTJ",
  "AUX",
  "MODAL",
  "NUM",
  "PART",
]);

function normalizePartOfSpeech(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim().toUpperCase();
  return PART_OF_SPEECH_LABELS.has(normalizedValue)
    ? normalizedValue
    : undefined;
}

function isExplanationResult(value: unknown): value is ExplanationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const result = value as Record<string, unknown>;
  const requiredFields = [
    "word",
    "phonetic",
    "translation",
    "general_meaning",
    "context_explanation",
    "example",
  ];

  return requiredFields.every((field) => typeof result[field] === "string");
}

export function parseExplanationResult(
  value: unknown,
  expectedWord: string,
): ExplanationResult {
  if (!isExplanationResult(value) || value.word !== expectedWord) {
    throw new InvalidExplanationError();
  }

  const partOfSpeech = normalizePartOfSpeech(value.part_of_speech);
  const { part_of_speech: _partOfSpeech, ...requiredResult } = value;

  return partOfSpeech === undefined
    ? requiredResult
    : { ...requiredResult, part_of_speech: partOfSpeech };
}
