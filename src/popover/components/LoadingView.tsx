import { ContextSurface } from "./ContextSurface";

export function LoadingView() {
  return (
    <div className="loading-view" aria-label="AI explanation is loading">
      <div className="meaning-skeleton" aria-hidden="true">
        <div className="skeleton skeleton--tag" />
        <div className="skeleton-line skeleton-line--meaning">
          <div className="skeleton skeleton--meaning" />
        </div>
      </div>

      <ContextSurface loading>
        <div className="context-skeleton" aria-hidden="true">
          <div className="skeleton-line skeleton-line--context">
            <div className="skeleton skeleton--context-wide" />
          </div>
          <div className="skeleton-line skeleton-line--context">
            <div className="skeleton skeleton--context-medium" />
          </div>
          <div className="skeleton-line skeleton-line--context">
            <div className="skeleton skeleton--context-short" />
          </div>
        </div>
      </ContextSurface>
    </div>
  );
}
