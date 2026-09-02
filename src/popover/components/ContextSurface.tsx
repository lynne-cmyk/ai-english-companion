import type { ReactNode } from "react";
import { SparkleIcon } from "./Icons";

export function ContextSurface({
  loading = false,
  children,
}: {
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="context-surface">
      <div className="context-surface__heading">
        {loading ? <span className="context-loader" aria-hidden="true" /> : <SparkleIcon />}
        <span>{loading ? "正在理解语境…" : "CONTEXT"}</span>
      </div>
      {children}
    </section>
  );
}
