import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PopoverStatePayload } from "../../electron/popoverIpc";
import { TranslatorPopover } from "./TranslatorPopover";
import { usePopoverSpeech } from "./speech/usePopoverSpeech";
import type { PopoverViewModel } from "./types";

const DISPLAY_PARTS_OF_SPEECH = new Set([
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

function getDisplayPartOfSpeech(value: string | undefined) {
  return value !== undefined && DISPLAY_PARTS_OF_SPEECH.has(value)
    ? value
    : undefined;
}

function toViewModel(payload: PopoverStatePayload): PopoverViewModel {
  if (payload.status === "result") {
    return {
      state: "result",
      content: {
        word: payload.result.word,
        phonetic: payload.result.phonetic,
        partOfSpeech: getDisplayPartOfSpeech(payload.result.part_of_speech),
        translation: payload.result.translation,
        context: [{ text: payload.result.context_explanation }],
      },
    };
  }

  return {
    state: payload.status,
    word: payload.word,
    ...(payload.status === "error"
      ? { failureCode: payload.failure.code }
      : {}),
  };
}

export function PopoverRenderer() {
  const [payload, setPayload] = useState<PopoverStatePayload | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = window.translatorPopover.onState((nextPayload) => {
      setPayload((currentPayload) => {
        if (
          currentPayload !== null &&
          nextPayload.requestId < currentPayload.requestId
        ) {
          return currentPayload;
        }

        return nextPayload;
      });
    });

    window.translatorPopover.ready();
    return unsubscribe;
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;

    if (payload === null || stage === null) {
      return;
    }

    let animationFrame = 0;
    let disposed = false;

    const reportHeight = () => {
      animationFrame = 0;

      if (disposed) {
        return;
      }

      const height = Math.ceil(stage.getBoundingClientRect().height);

      if (height > 0) {
        window.translatorPopover.reportContentHeight({
          requestId: payload.requestId,
          status: payload.status,
          height,
        });
      }
    };

    const scheduleMeasurement = () => {
      if (animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = requestAnimationFrame(reportHeight);
    };

    const observer = new ResizeObserver(scheduleMeasurement);
    observer.observe(stage);
    reportHeight();
    void document.fonts.ready.then(reportHeight);

    return () => {
      disposed = true;
      observer.disconnect();

      if (animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [payload]);

  const model = useMemo(
    () => (payload === null ? null : toViewModel(payload)),
    [payload],
  );
  const resultWord =
    payload?.status === "result" ? payload.result.word : null;
  const {
    speakerActive,
    speakerDisabled,
    speak,
  } = usePopoverSpeech({
    resultId: payload?.status === "result" ? payload.requestId : null,
    word: resultWord,
  });

  if (model === null) {
    return null;
  }

  return (
    <div className="popover-production-stage" ref={stageRef}>
      <TranslatorPopover
        model={model}
        speakerActive={speakerActive}
        speakerDisabled={speakerDisabled}
        retryDisabled={
          payload === null ||
          (payload.status !== "error" && payload.status !== "offline") ||
          !payload.failure.retryable
        }
        onSpeakerToggle={speak}
        onRetry={() => {
          if (payload !== null &&
            (payload.status === "error" || payload.status === "offline") &&
            payload.failure.retryable) {
            window.translatorPopover.retry(payload.requestId);
          }
        }}
      />
    </div>
  );
}
