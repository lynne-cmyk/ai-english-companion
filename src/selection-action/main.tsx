import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SelectionActionButton,
  type SelectionActionVisualState,
} from "./SelectionActionButton";
import "./selection-action.css";

interface SelectionActionWindowState {
  visible: boolean;
  selectionId: string | null;
}

interface SelectionActionWindowBridge {
  onState(listener: (state: SelectionActionWindowState) => void): () => void;
  pointerDown(selectionId: string): void;
  click(selectionId: string): void;
  rendered(
    selectionId: string,
    phase: "mounted" | "settled",
    metrics: {
      width: number;
      height: number;
      opacity: number;
      devicePixelRatio: number;
    },
  ): void;
  ready(): void;
}

declare global {
  interface Window {
    selectionAction?: SelectionActionWindowBridge;
  }
}

const previewStates: Array<{
  label: string;
  state: SelectionActionVisualState;
}> = [
  { label: "Default", state: "default" },
  { label: "Hover", state: "hover" },
  { label: "Pressed", state: "pressed" },
  { label: "Focus", state: "focus" },
];

function SelectedWordWithAction() {
  return (
    <span className="selection-action-example__anchor">
      <mark className="selection-action-example__selection">component</mark>
      <SelectionActionButton />
    </span>
  );
}

function ContextExample({
  title,
  surface,
}: {
  title: string;
  surface: "white" | "gray";
}) {
  return (
    <article
      className={`selection-action-example selection-action-example--${surface}`}
    >
      <h3>{title}</h3>
      <p>
        In modern frameworks, a <SelectedWordWithAction /> is a self-contained
        piece of an interface that can be reused throughout a product.
      </p>
    </article>
  );
}

function SelectionActionPreview() {
  return (
    <main className="selection-action-preview">
      <header className="selection-action-preview__header">
        <p className="selection-action-preview__eyebrow">Visual preview</p>
        <h1>Selection Action Button v1.1</h1>
        <p>
          A 28px action surface beside selected 15px text, with a 32px hit area.
        </p>
      </header>

      <section className="selection-action-preview__section">
        <h2>Interaction states</h2>
        <div className="selection-action-states">
          {previewStates.map(({ label, state }) => (
            <div className="selection-action-state" key={state}>
              <SelectionActionButton previewState={state} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="selection-action-preview__section">
        <h2>In context</h2>
        <div className="selection-action-examples">
          <ContextExample title="White webpage background" surface="white" />
          <ContextExample
            title="Light-gray application background"
            surface="gray"
          />
        </div>
      </section>
    </main>
  );
}

function SelectionActionWindow() {
  const canvasRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<SelectionActionWindowState>({
    visible: false,
    selectionId: null,
  });

  useEffect(() => {
    const bridge = window.selectionAction;
    if (!bridge) return undefined;
    const unsubscribe = bridge.onState(setState);
    bridge.ready();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!state.visible || !state.selectionId) return undefined;
    const selectionId = state.selectionId;
    let frame = 0;

    const report = (phase: "mounted" | "settled") => {
      const button = canvasRef.current?.querySelector<HTMLButtonElement>(
        ".selection-action-button",
      );
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const opacity = Number.parseFloat(getComputedStyle(button).opacity);
      window.selectionAction?.rendered(selectionId, phase, {
        width: rect.width,
        height: rect.height,
        opacity: Number.isFinite(opacity) ? opacity : -1,
        devicePixelRatio: window.devicePixelRatio,
      });
    };

    frame = window.requestAnimationFrame(() => report("mounted"));
    const settledTimer = window.setTimeout(() => report("settled"), 200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settledTimer);
    };
  }, [state]);

  return (
    <main className="selection-action-window__canvas" ref={canvasRef}>
      {state.visible && state.selectionId ? (
        <SelectionActionButton
          onPointerDown={() =>
            window.selectionAction?.pointerDown(state.selectionId as string)
          }
          onClick={() =>
            window.selectionAction?.click(state.selectionId as string)
          }
        />
      ) : null}
    </main>
  );
}

const rootElement = document.getElementById("selection-action-root");

if (!rootElement) {
  throw new Error("Selection action preview root was not found.");
}

const isWindowRenderer =
  new URLSearchParams(window.location.search).get("mode") === "window";

if (isWindowRenderer) {
  document.documentElement.classList.add("selection-action-window");
}

createRoot(rootElement).render(
  <StrictMode>
    {isWindowRenderer ? <SelectionActionWindow /> : <SelectionActionPreview />}
  </StrictMode>,
);
