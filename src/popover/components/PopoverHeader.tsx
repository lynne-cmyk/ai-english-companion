import { BookmarkButton, SpeakerButton } from "./ActionButtons";

export type HeaderVariant = "result" | "loading" | "compact";

export function PopoverHeader({
  variant,
  word,
  phonetic,
  bookmarked,
  speakerActive,
  speakerDisabled = false,
  onBookmarkToggle,
  onSpeakerToggle,
}: {
  variant: HeaderVariant;
  word: string;
  phonetic?: string;
  bookmarked: boolean;
  speakerActive: boolean;
  speakerDisabled?: boolean;
  onBookmarkToggle: () => void;
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
          <div className="header-phonetic-skeleton skeleton" aria-label="Loading pronunciation" />
        )}
      </div>

      <BookmarkButton
        saved={variant === "result" && bookmarked}
        disabled={variant !== "result"}
        onToggle={onBookmarkToggle}
      />
    </header>
  );
}
