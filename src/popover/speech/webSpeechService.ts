import type { SpeechCallbacks, SpeechService } from "./speechService";

type SpeechSynthesisAdapter = Pick<
  SpeechSynthesis,
  "addEventListener" | "cancel" | "getVoices" | "removeEventListener" | "speak"
>;

type UtteranceFactory = (word: string) => SpeechSynthesisUtterance;

export interface WebSpeechServiceOptions {
  synthesis?: SpeechSynthesisAdapter | null;
  createUtterance?: UtteranceFactory | null;
}

function normalizedLanguage(voice: SpeechSynthesisVoice) {
  return voice.lang.trim().replaceAll("_", "-").toLowerCase();
}

function isEnglishLanguage(language: string) {
  return language === "en" || language.startsWith("en-");
}

export function selectPreferredLocalEnglishVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const localEnglishVoices = voices.filter(
    (voice) =>
      voice.localService && isEnglishLanguage(normalizedLanguage(voice)),
  );
  const localAmericanVoices = localEnglishVoices.filter(
    (voice) => normalizedLanguage(voice) === "en-us",
  );

  return (
    localAmericanVoices.find((voice) => voice.default) ??
    localAmericanVoices[0] ??
    localEnglishVoices.find((voice) => voice.default) ??
    localEnglishVoices[0] ??
    null
  );
}

function browserSpeechSynthesis(): SpeechSynthesisAdapter | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

function browserUtteranceFactory(): UtteranceFactory | null {
  return typeof SpeechSynthesisUtterance === "undefined"
    ? null
    : (word) => new SpeechSynthesisUtterance(word);
}

export class WebSpeechService implements SpeechService {
  private readonly synthesis: SpeechSynthesisAdapter | null;
  private readonly createUtterance: UtteranceFactory | null;
  private sessionId = 0;

  constructor(options: WebSpeechServiceOptions = {}) {
    this.synthesis =
      options.synthesis === undefined
        ? browserSpeechSynthesis()
        : options.synthesis;
    this.createUtterance =
      options.createUtterance === undefined
        ? browserUtteranceFactory()
        : options.createUtterance;
  }

  isAvailable(): boolean {
    return this.preferredVoice() !== null && this.createUtterance !== null;
  }

  speak(word: string, callbacks: SpeechCallbacks = {}): boolean {
    const spokenWord = word.trim();

    if (
      spokenWord === "" ||
      this.synthesis === null ||
      this.createUtterance === null
    ) {
      return false;
    }

    this.cancel();

    const voice = this.preferredVoice();
    if (voice === null) {
      return false;
    }

    const currentSessionId = ++this.sessionId;
    let utterance: SpeechSynthesisUtterance;

    try {
      utterance = this.createUtterance(spokenWord);
      utterance.lang = "en-US";
      utterance.voice = voice;
      utterance.onstart = () => {
        if (this.sessionId === currentSessionId) callbacks.onStart?.();
      };
      utterance.onend = () => {
        if (this.sessionId !== currentSessionId) return;
        this.sessionId += 1;
        callbacks.onEnd?.();
      };
      utterance.onerror = () => {
        if (this.sessionId !== currentSessionId) return;
        this.sessionId += 1;
        callbacks.onError?.();
      };
      this.synthesis.speak(utterance);
      return true;
    } catch {
      if (this.sessionId === currentSessionId) {
        this.sessionId += 1;
        callbacks.onError?.();
      }
      return false;
    }
  }

  cancel(): void {
    this.sessionId += 1;

    try {
      this.synthesis?.cancel();
    } catch {
      // Pronunciation is optional and must never affect translation behavior.
    }
  }

  subscribeAvailability(
    listener: (available: boolean) => void,
  ): () => void {
    if (this.synthesis === null) return () => undefined;

    const handleVoicesChanged = () => {
      listener(this.isAvailable());
    };

    try {
      this.synthesis.addEventListener("voiceschanged", handleVoicesChanged);
    } catch {
      return () => undefined;
    }

    return () => {
      try {
        this.synthesis?.removeEventListener(
          "voiceschanged",
          handleVoicesChanged,
        );
      } catch {
        // Voice readiness is optional and cleanup must stay isolated.
      }
    };
  }

  private preferredVoice(): SpeechSynthesisVoice | null {
    if (this.synthesis === null) return null;

    try {
      return selectPreferredLocalEnglishVoice(this.synthesis.getVoices());
    } catch {
      return null;
    }
  }
}
