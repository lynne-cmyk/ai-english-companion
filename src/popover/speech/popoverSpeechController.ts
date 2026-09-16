import type { SpeechCallbacks, SpeechService } from "./speechService";

export interface PopoverSpeechState {
  available: boolean;
  active: boolean;
  canSpeak: boolean;
}

type StateListener = (state: PopoverSpeechState) => void;

export class PopoverSpeechController {
  private readonly speechService: SpeechService;
  private available: boolean;
  private active = false;
  private resultId: number | null = null;
  private word: string | null = null;
  private lifecycleId = 0;
  private listener: StateListener | null = null;
  private unsubscribeAvailability: (() => void) | null = null;
  private connected = false;

  constructor(speechService: SpeechService) {
    this.speechService = speechService;
    this.available = speechService.isAvailable();
  }

  getState(): PopoverSpeechState {
    return {
      available: this.available,
      active: this.active,
      canSpeak: this.available && this.word !== null,
    };
  }

  connect(listener: StateListener): () => void {
    if (this.connected || this.unsubscribeAvailability !== null) {
      this.disconnect();
    }
    this.connected = true;
    this.listener = listener;
    this.available = this.speechService.isAvailable();
    this.emit();
    this.unsubscribeAvailability = this.speechService.subscribeAvailability(
      (available) => {
        if (!this.connected) return;

        this.available = available;
        if (!available) {
          this.cancelPlayback();
          return;
        }

        this.emit();
      },
    );

    return () => this.disconnect();
  }

  setResult(resultId: number | null, word: string | null): void {
    const nextWord = word?.trim() || null;

    if (this.resultId === resultId && this.word === nextWord) return;

    this.resultId = resultId;
    this.word = nextWord;
    this.cancelPlayback();
  }

  speak(): boolean {
    if (!this.connected || !this.available || this.word === null) return false;

    const currentLifecycleId = ++this.lifecycleId;
    this.setActive(false);

    const callbacks: SpeechCallbacks = {
      onStart: () => {
        if (this.isCurrent(currentLifecycleId)) this.setActive(true);
      },
      onEnd: () => {
        if (this.isCurrent(currentLifecycleId)) this.setActive(false);
      },
      onError: () => {
        if (this.isCurrent(currentLifecycleId)) this.setActive(false);
      },
    };
    const started = this.speechService.speak(this.word, callbacks);

    if (!started && this.isCurrent(currentLifecycleId)) this.setActive(false);
    return started;
  }

  handleVisibility(hidden: boolean): void {
    if (hidden) this.cancelPlayback();
  }

  disconnect(): void {
    this.connected = false;
    this.listener = null;
    this.unsubscribeAvailability?.();
    this.unsubscribeAvailability = null;
    this.cancelPlayback();
  }

  private cancelPlayback(): void {
    this.lifecycleId += 1;
    this.speechService.cancel();
    this.active = false;
    this.emit();
  }

  private isCurrent(lifecycleId: number): boolean {
    return this.connected && this.lifecycleId === lifecycleId;
  }

  private setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.emit();
  }

  private emit(): void {
    this.listener?.(this.getState());
  }
}
