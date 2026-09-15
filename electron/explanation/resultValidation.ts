import { InvalidExplanationError } from "../aiRecovery";
import type { ExplanationResult } from "./contracts";

const PART_OF_SPEECH_ALIASES: Readonly<Record<string, string>> = {
  N: "NOUN", NOUN: "NOUN",
  V: "VERB", VERB: "VERB",
  ADJ: "ADJ", ADJECTIVE: "ADJ",
  ADV: "ADV", ADVERB: "ADV",
  PREP: "PREP", PREPOSITION: "PREP",
  PRON: "PRON", PRONOUN: "PRON",
  CONJ: "CONJ", CONJUNCTION: "CONJ",
  DET: "DET", DETERMINER: "DET",
  ART: "ART", ARTICLE: "ART",
  INTJ: "INTJ", INTERJECTION: "INTJ",
  AUX: "AUX", AUXILIARY: "AUX",
  MODAL: "MODAL",
  NUM: "NUM", NUMBER: "NUM", NUMERAL: "NUM",
  PART: "PART", PARTICLE: "PART",
};

function normalizePartOfSpeech(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim().toUpperCase().replace(/\.$/, "");
  return PART_OF_SPEECH_ALIASES[normalizedValue];
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
  if (
    !isExplanationResult(value) ||
    value.word !== expectedWord ||
    value.translation.trim() === "" ||
    !/\p{Script=Han}/u.test(value.translation)
  ) {
    throw new InvalidExplanationError();
  }

  const partOfSpeech = normalizePartOfSpeech(value.part_of_speech);
  const { part_of_speech: _partOfSpeech, ...requiredResult } = value;

  return partOfSpeech === undefined
    ? requiredResult
    : { ...requiredResult, part_of_speech: partOfSpeech };
}
