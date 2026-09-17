import type { PopoverViewModel } from "./types";
import { LoadingView } from "./components/LoadingView";
import { PopoverHeader, type HeaderVariant } from "./components/PopoverHeader";
import { ResultView } from "./components/ResultView";
import { StatusView } from "./components/StatusView";

export function TranslatorPopover({
  model,
  speakerActive,
  speakerDisabled = false,
  retryDisabled = false,
  onSpeakerToggle,
  onRetry,
}: {
  model: PopoverViewModel;
  speakerActive: boolean;
  speakerDisabled?: boolean;
  retryDisabled?: boolean;
  onSpeakerToggle: () => void;
  onRetry: () => void;
}) {
  const isResult = model.state === "result";
  const headerVariant: HeaderVariant = isResult
    ? "result"
    : model.state === "loading"
      ? "loading"
      : "compact";
  const word = isResult ? model.content.word : model.word;

  return (
    <article
      className={`translator-popover${isResult && model.longContent ? " translator-popover--long" : ""}`}
      data-state={model.state}
    >
      <PopoverHeader
        variant={headerVariant}
        word={word}
        phonetic={isResult ? model.content.phonetic : undefined}
        speakerActive={speakerActive}
        speakerDisabled={speakerDisabled}
        onSpeakerToggle={onSpeakerToggle}
      />
      <div className="popover-divider" />
      <div className={`popover-body popover-body--${model.state}`}>
        {model.state === "result" && <ResultView content={model.content} />}
        {model.state === "loading" && <LoadingView />}
        {model.state === "error" && (
          <StatusView
            kind="error"
            failureCode={model.failureCode}
            retryDisabled={retryDisabled}
            onRetry={onRetry}
          />
        )}
        {model.state === "offline" && (
          <StatusView
            kind="offline"
            retryDisabled={retryDisabled}
            onRetry={onRetry}
          />
        )}
      </div>
    </article>
  );
}
