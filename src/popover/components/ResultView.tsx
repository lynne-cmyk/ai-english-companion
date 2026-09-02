import type { ResultContent } from "../types";
import { ContextSurface } from "./ContextSurface";

export function ResultView({ content }: { content: ResultContent }) {
  return (
    <div className="result-view">
      <section className="meaning-section">
        <span className="part-of-speech">{content.partOfSpeech}</span>
        <p className="translation zh-copy">{content.translation}</p>
      </section>

      <ContextSurface>
        <p className="context-copy zh-copy">
          {content.context.map((segment, index) =>
            segment.highlight ? (
              <mark key={`${segment.text}-${index}`}>{segment.text}</mark>
            ) : (
              <span key={`${segment.text}-${index}`}>{segment.text}</span>
            ),
          )}
        </p>
      </ContextSurface>
    </div>
  );
}
