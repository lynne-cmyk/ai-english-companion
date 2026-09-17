import { SpeakerButton } from "./ActionButtons";

export type HeaderVariant = "result" | "loading" | "compact";

export function PopoverHeader({
  variant,
  word,
  phonetic,
  speakerActive,
  speakerDisabled = false,
  onSpeakerToggle,
}: {
  variant: HeaderVariant;
  word: string;
  phonetic?: string;
  speakerActive: boolean;
  speakerDisabled?: boolean;
  onSpeakerToggle: () => void;
}) {
  return (
    <header className={`popover-header popover-header--${variant}`}>
      <div className="popover-header__copy">
        <h1 className="popover-word">{word}</h1>

        {variant === "result" && (
          <div className="pronunciation-row">
            <span className="phonetic">{phonetic}</span>
            <SpeakerButton
              active={speakerActive}
              disabled={speakerDisabled}
              onToggle={onSpeakerToggle}
            />
          </div>
        )}

        {variant === "loading" && (
          <div className="pronunciation-row" aria-label="Loading pronunciation">
            <div className="header-phonetic-skeleton skeleton" aria-hidden="true" />
            <span className="header-speaker-placeholder" aria-hidden="true" />
          </div>
        )}
      </div>
    </header>
  );
}
