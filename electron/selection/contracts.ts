export const SELECTION_ACTION_CHANNELS = {
  ready: "selection-action:ready",
  state: "selection-action:state",
  pointerDown: "selection-action:pointer-down",
  click: "selection-action:click",
  rendered: "selection-action:rendered",
} as const;

export interface SelectionActionRendererState {
  visible: boolean;
  selectionId: string | null;
}

export interface SelectionActionBridge {
  onState(listener: (state: SelectionActionRendererState) => void): () => void;
  pointerDown(selectionId: string): void;
  click(selectionId: string): void;
  rendered(
    selectionId: string,
    phase: "mounted" | "settled",
    metrics: SelectionActionRenderMetrics,
  ): void;
  ready(): void;
}

export interface SelectionActionRenderMetrics {
  width: number;
  height: number;
  opacity: number;
  devicePixelRatio: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}
