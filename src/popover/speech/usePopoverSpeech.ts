import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { PopoverSpeechController } from "./popoverSpeechController";
import { WebSpeechService } from "./webSpeechService";

export function usePopoverSpeech({
  resultId,
  word,
}: {
  resultId: number | null;
  word: string | null;
}) {
  const [controller] = useState(
    () => new PopoverSpeechController(new WebSpeechService()),
  );
  const [state, setState] = useState(() => controller.getState());

  useLayoutEffect(() => controller.connect(setState), [controller]);

  useLayoutEffect(() => {
    controller.setResult(resultId, word);
  }, [controller, resultId, word]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      controller.handleVisibility(document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [controller]);

  const speak = useCallback(() => controller.speak(), [controller]);

  return {
    speakerActive: state.active,
    speakerDisabled: !state.canSpeak,
    speak,
  };
}
