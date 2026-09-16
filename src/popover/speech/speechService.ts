export interface SpeechCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

export interface SpeechService {
  isAvailable(): boolean;
  speak(word: string, callbacks?: SpeechCallbacks): boolean;
  cancel(): void;
  subscribeAvailability(listener: (available: boolean) => void): () => void;
}
