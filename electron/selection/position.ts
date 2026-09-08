import type { Point, Rect } from "./contracts";

export const ACTION_WINDOW_SIZE = 36;
export const ACTION_HIT_SIZE = 32;
export const ACTION_SURFACE_SIZE = 28;
export const ACTION_WINDOW_INSET =
  (ACTION_WINDOW_SIZE - ACTION_SURFACE_SIZE) / 2;
export const SELECTION_VISUAL_GAP = 6;
export const MOUSE_FALLBACK_HORIZONTAL_OFFSET = 8;
export const MOUSE_FALLBACK_VERTICAL_GAP = 3;

export type ActionPlacement =
  | "selection_right"
  | "selection_left"
  | "above_right"
  | "above_left"
  | "below_right"
  | "below_left";

export interface PositionInput {
  selectionBounds?: Rect;
  mousePosition: Point;
  workArea: Rect;
}

export interface PositionResult extends Point {
  anchorSource: "selection_bounds" | "mouse_position";
  placement: ActionPlacement;
  flipped: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function intersects(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function isValidSelectionBounds(
  value: unknown,
  workArea?: Rect,
): value is Rect {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Partial<Rect>;
  if (
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) ||
    !isFiniteNumber(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return false;
  }

  if (bounds.width > 4096 || bounds.height > 2048) return false;

  if (workArea) {
    const maximumUsefulWidth = Math.min(2000, workArea.width * 0.9);
    const maximumUsefulHeight = Math.min(800, workArea.height * 0.8);
    if (
      bounds.width > maximumUsefulWidth ||
      bounds.height > maximumUsefulHeight ||
      !intersects(bounds as Rect, workArea)
    ) {
      return false;
    }
  }

  return true;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function calculateActionPosition({
  selectionBounds,
  mousePosition,
  workArea,
}: PositionInput): PositionResult {
  const useBounds = isValidSelectionBounds(selectionBounds, workArea);
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;

  if (!useBounds) {
    let isLeft = false;
    let isBelow = false;
    let x = mousePosition.x + MOUSE_FALLBACK_HORIZONTAL_OFFSET;
    let y =
      mousePosition.y - ACTION_WINDOW_SIZE - MOUSE_FALLBACK_VERTICAL_GAP;

    if (x + ACTION_WINDOW_SIZE > workRight) {
      x =
        mousePosition.x -
        MOUSE_FALLBACK_HORIZONTAL_OFFSET -
        ACTION_WINDOW_SIZE;
      isLeft = true;
    }

    if (y < workArea.y) {
      y = mousePosition.y + MOUSE_FALLBACK_VERTICAL_GAP;
      isBelow = true;
    }

    return {
      x: Math.round(
        clamp(
          x,
          workArea.x,
          Math.max(workArea.x, workRight - ACTION_WINDOW_SIZE),
        ),
      ),
      y: Math.round(
        clamp(
          y,
          workArea.y,
          Math.max(workArea.y, workBottom - ACTION_WINDOW_SIZE),
        ),
      ),
      anchorSource: "mouse_position",
      placement: isBelow
        ? isLeft
          ? "below_left"
          : "below_right"
        : isLeft
          ? "above_left"
          : "above_right",
      flipped: isLeft,
    };
  }

  const verticalCenter = selectionBounds.y + selectionBounds.height / 2;
  const rightAnchor = selectionBounds.x + selectionBounds.width;
  const leftAnchor = selectionBounds.x;

  let x = rightAnchor + SELECTION_VISUAL_GAP - ACTION_WINDOW_INSET;
  let flipped = false;

  if (x + ACTION_WINDOW_SIZE > workRight) {
    x =
      leftAnchor -
      SELECTION_VISUAL_GAP -
      ACTION_SURFACE_SIZE -
      ACTION_WINDOW_INSET;
    flipped = true;
  }

  const y = verticalCenter - ACTION_SURFACE_SIZE / 2 - ACTION_WINDOW_INSET;

  return {
    x: Math.round(
      clamp(x, workArea.x, Math.max(workArea.x, workRight - ACTION_WINDOW_SIZE)),
    ),
    y: Math.round(
      clamp(y, workArea.y, Math.max(workArea.y, workBottom - ACTION_WINDOW_SIZE)),
    ),
    anchorSource: "selection_bounds",
    placement: flipped ? "selection_left" : "selection_right",
    flipped,
  };
}
