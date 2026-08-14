import type { AIProvider } from "./provider";
import { AIProviderError } from "./provider";
import type {
  ExplanationResult,
  GenerateExplanationInput,
} from "./types";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 5_000;

export const DEEPSEEK_SYSTEM_PROMPT = `You are AI English Companion, a personal English assistant for people working on macOS.

Your job is to help the user understand a copied English word quickly, with minimal interruption to their work.

You will receive a JSON object with:
- word: the copied English word
- source_app: the macOS app that was in the foreground when the word was copied
- user_goal: what the user wants to achieve

Explain the word in concise Chinese. Provide its phonetic transcription, a short translation, its general meaning, a context-aware explanation, and one short English example.

Use source_app only as a contextual hint. For example, a word copied in Cursor may have a software-development meaning, while a word copied in Figma may have a product-design meaning. Do not claim to know the exact sentence, document, screen, or user intention. If the app does not provide enough context, give a cautious explanation of the most likely usage.

Speak like a helpful work partner, not a teacher. Do not lecture, quiz, grade, or over-explain. Keep every explanation concise and practical.

Return only one valid JSON object. Do not use Markdown. Do not add text before or after the JSON. Do not omit any field.

The JSON schema is:
{
  "word": "string",
  "phonetic": "string",
  "translation": "string",
  "general_meaning": "string",
  "context_explanation": "string",
  "example": "string"
}

All values must be strings. Preserve the input word in the word field. If a value cannot be determined reliably, return an empty string for that field instead of inventing information.`;

interface DeepSeekProviderOptions {
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

interface DeepSeekChatCompletion {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExplanationResult(
  content: string,
  expectedWord: string,
): ExplanationResult {
  let value: unknown;

  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "DeepSeek returned invalid JSON",
      { cause: error },
    );
  }

  if (!isRecord(value)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "DeepSeek response must be a JSON object",
    );
  }

  const requiredFields = [
    "word",
    "phonetic",
    "translation",
    "general_meaning",
    "context_explanation",
    "example",
  ] as const;

  for (const field of requiredFields) {
    if (typeof value[field] !== "string") {
      throw new AIProviderError(
        "INVALID_RESPONSE",
        `DeepSeek response has an invalid ${field} field`,
      );
    }
  }

  const result = value as unknown as ExplanationResult;

  if (result.word !== expectedWord) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "DeepSeek response did not preserve the input word",
    );
  }

  return {
    word: result.word,
    phonetic: result.phonetic,
    translation: result.translation,
    general_meaning: result.general_meaning,
    context_explanation: result.context_explanation,
    example: result.example,
  };
}

function getMessageContent(value: unknown): string {
  if (!isRecord(value)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "DeepSeek returned an unexpected response",
    );
  }

  const response = value as DeepSeekChatCompletion;
  const content = response.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "DeepSeek response did not contain JSON content",
    );
  }

  return content;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class DeepSeekAIProvider implements AIProvider {
  readonly name = "deepseek";

  private readonly environment: NodeJS.ProcessEnv;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DeepSeekProviderOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateExplanation(
    input: GenerateExplanationInput,
  ): Promise<ExplanationResult> {
    const apiKey = this.environment.DEEPSEEK_API_KEY?.trim();

    if (!apiKey) {
      throw new AIProviderError(
        "MISSING_API_KEY",
        "DEEPSEEK_API_KEY is not configured",
      );
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 600,
          stream: false,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new AIProviderError(
          "HTTP_ERROR",
          `DeepSeek request failed with HTTP ${response.status}`,
          { httpStatus: response.status },
        );
      }

      let responseBody: unknown;

      try {
        responseBody = await response.json();
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          throw error;
        }

        throw new AIProviderError(
          "INVALID_RESPONSE",
          "DeepSeek returned an unreadable response body",
          { cause: error },
        );
      }

      return parseExplanationResult(
        getMessageContent(responseBody),
        input.word,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      if (abortController.signal.aborted || isAbortError(error)) {
        throw new AIProviderError(
          "TIMEOUT",
          `DeepSeek request timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }

      throw new AIProviderError(
        "NETWORK_ERROR",
        "DeepSeek network request failed",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
