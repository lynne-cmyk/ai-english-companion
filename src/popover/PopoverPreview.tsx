import { useMemo, useState } from "react";
import { getPreviewModel, previewLabels } from "./fixtures";
import { TranslatorPopover } from "./TranslatorPopover";
import type { PreviewMode } from "./types";

const previewModes = Object.keys(previewLabels) as PreviewMode[];

export function PopoverPreview() {
  const [mode, setMode] = useState<PreviewMode>("result");
  const [speakerActive, setSpeakerActive] = useState(false);
  const model = useMemo(() => getPreviewModel(mode), [mode]);

  function selectMode(nextMode: PreviewMode) {
    setMode(nextMode);
    setSpeakerActive(false);
  }

  return (
    <main className="popover-preview-page">
      <section className="preview-toolbar" aria-label="Popover fixture controls">
        <div>
          <p className="preview-eyebrow">Translator Popover</p>
          <h2>Static UI Final v4.2</h2>
        </div>
        <div className="preview-state-switcher" role="group" aria-label="Preview state">
          {previewModes.map((previewMode) => (
            <button
              type="button"
              key={previewMode}
              aria-pressed={mode === previewMode}
              onClick={() => selectMode(previewMode)}
            >
              {previewLabels[previewMode]}
            </button>
          ))}
        </div>
      </section>

      <section className="preview-stage" aria-live="polite">
        <TranslatorPopover
          model={model}
          speakerActive={speakerActive}
          onSpeakerToggle={() => setSpeakerActive((value) => !value)}
          onRetry={() => selectMode("loading")}
        />
        <p className="preview-note">
          Speaker and retry controls are local visual fixtures only.
        </p>
      </section>
    </main>
  );
}
