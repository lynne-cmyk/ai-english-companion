import { randomUUID } from "node:crypto";
import type { Point, Rect } from "./contracts";
import { isValidPoint, isValidSelectionBounds } from "./position";

const SAMPLE_MARKER = "[selection-probe] sample";
const STATUS_MARKER = "[selection-probe] status";
const PROBE_MARKERS = [
  { marker: SAMPLE_MARKER, type: "sample" as const },
  { marker: STATUS_MARKER, type: "status" as const },
];
// SelectionProbe emits bounded but detailed metadata for up to 64 AX nodes.
// 256KB keeps that legitimate pretty-printed record bounded without mixing
// unrelated stdout because parsing begins only after the exact sample marker.
export const DEFAULT_MAX_PROBE_RECORD_SIZE = 256 * 1024;
const MAX_SELECTION_LENGTH = 512;
const SELF_MOUSE_UP_PROTECTION_MS = 1_000;
// Retained diagnostic threshold from the drag experiment. Native CGEvent
// coordinates are macOS global points and are not Retina-scaled. PASS 3
// production eligibility is double-click-only.
export const DRAG_SELECTION_THRESHOLD_POINTS = 4;

export type ProbeParserEvent =
  | { type: "sample"; value: unknown }
  | { type: "status"; value: unknown }
  | { type: "statusMalformed"; reason: string }
  | { type: "malformed"; reason: string }
  | {
      type: "overflow";
      reason: string;
      observedBytes: number;
      limitBytes: number;
    };

export class ProbeSampleParser {
  private buffer = "";

  constructor(
    private readonly maximumRecordSize = DEFAULT_MAX_PROBE_RECORD_SIZE,
  ) {}

  push(chunk: string): ProbeParserEvent[] {
    this.buffer += chunk;
    const events: ProbeParserEvent[] = [];

    while (this.buffer.length > 0) {
      const nextMarker = this.findNextMarker();
      if (nextMarker === null) {
        const retainedLength = Math.min(
          this.buffer.length,
          Math.max(...PROBE_MARKERS.map(({ marker }) => marker.length)) - 1,
        );
        this.buffer = this.buffer.slice(-retainedLength);
        break;
      }

      if (nextMarker.index > 0) {
        this.buffer = this.buffer.slice(nextMarker.index);
      }

      const jsonStart = this.findJsonStart(nextMarker.marker.length);
      if (jsonStart < 0) {
        if (Buffer.byteLength(this.buffer, "utf8") > this.maximumRecordSize) {
          if (nextMarker.type === "status") {
            events.push({
              type: "statusMalformed",
              reason: "record_buffer_limit",
            });
          } else {
            events.push({
              type: "overflow",
              reason: "record_buffer_limit",
              observedBytes: Buffer.byteLength(this.buffer, "utf8"),
              limitBytes: this.maximumRecordSize,
            });
          }
          this.buffer = "";
        }
        break;
      }

      const recordEnd = this.findJsonEnd(jsonStart);
      if (recordEnd < 0) {
        const followingMarker = this.findNextMarker(jsonStart + 1);
        if (followingMarker !== null) {
          events.push(
            nextMarker.type === "status"
              ? { type: "statusMalformed", reason: "record_interrupted" }
              : { type: "malformed", reason: "record_interrupted" },
          );
          this.buffer = this.buffer.slice(followingMarker.index);
          continue;
        }
        if (
          Buffer.byteLength(this.buffer.slice(jsonStart), "utf8") >
          this.maximumRecordSize
        ) {
          if (nextMarker.type === "status") {
            events.push({
              type: "statusMalformed",
              reason: "record_buffer_limit",
            });
          } else {
            events.push({
              type: "overflow",
              reason: "record_buffer_limit",
              observedBytes: Buffer.byteLength(
                this.buffer.slice(jsonStart),
                "utf8",
              ),
              limitBytes: this.maximumRecordSize,
            });
          }
          this.buffer = "";
        }
        break;
      }

      const record = this.buffer.slice(jsonStart, recordEnd + 1);
      this.buffer = this.buffer.slice(recordEnd + 1);

      if (Buffer.byteLength(record, "utf8") > this.maximumRecordSize) {
        if (nextMarker.type === "status") {
          events.push({
            type: "statusMalformed",
            reason: "record_buffer_limit",
          });
        } else {
          events.push({
            type: "overflow",
            reason: "record_buffer_limit",
            observedBytes: Buffer.byteLength(record, "utf8"),
            limitBytes: this.maximumRecordSize,
          });
        }
        continue;
      }

      try {
        events.push({ type: nextMarker.type, value: JSON.parse(record) });
      } catch {
        events.push(
          nextMarker.type === "status"
            ? { type: "statusMalformed", reason: "invalid_json" }
            : { type: "malformed", reason: "invalid_json" },
        );
      }
    }

    return events;
  }

  private findNextMarker(fromIndex = 0) {
    let result: {
      index: number;
      marker: string;
      type: "sample" | "status";
    } | null = null;

    for (const candidate of PROBE_MARKERS) {
      const index = this.buffer.indexOf(candidate.marker, fromIndex);
      if (index >= 0 && (result === null || index < result.index)) {
        result = { index, ...candidate };
      }
    }
    return result;
  }

  private findJsonStart(markerLength: number) {
    let index = markerLength;
    while (index < this.buffer.length && /\s/.test(this.buffer[index])) {
      index += 1;
    }
    return this.buffer[index] === "{" ? index : -1;
  }

  private findJsonEnd(start: number) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return index;
        if (depth < 0) return -1;
      }
    }

    return -1;
  }
}

interface NormalizedProbeSample {
  sampleId: number;
  text: string | null;
  sourceApp: string | null;
  pid: number | null;
  bundleId: string | null;
  range?: SelectionTextRange;
  bounds?: Rect;
  mousePosition?: Point;
  capturedAt: number;
  accessibility: string | null;
  gestureGeneration: number | null;
  gesturePresent: boolean;
  gestureButton: string | null;
  gestureClickCount: number;
  gestureDidDrag: boolean;
  gestureMaxDragDistance: number;
  gestureComplete: boolean;
  gestureQualifies: boolean;
  usable: boolean;
  stale: boolean;
  discarded: boolean;
}

interface SelectionTextRange {
  location: number;
  length: number;
}

export interface SelectionSnapshot {
  selectionId: string;
  sampleId: number;
  text: string;
  sourceApp: string;
  pid: number;
  bundleId: string | null;
  range?: SelectionTextRange;
  bounds?: Rect;
  mousePosition: Point;
  capturedAt: number;
  gestureGeneration: number;
  consumed: boolean;
}

export type SessionUpdate =
  | { kind: "show"; snapshot: SelectionSnapshot }
  | { kind: "hide"; reason: string }
  | { kind: "ignore"; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPoint(value: unknown): Point | undefined {
  return isValidPoint(value) ? { x: value.x, y: value.y } : undefined;
}

function readBounds(value: unknown): Rect | undefined {
  return isValidSelectionBounds(value)
    ? { x: value.x, y: value.y, width: value.width, height: value.height }
    : undefined;
}

function readRange(value: unknown): SelectionTextRange | undefined {
  const range = asRecord(value);
  const location = finiteNumber(range?.location);
  const length = finiteNumber(range?.length);
  return location !== null &&
    length !== null &&
    Number.isSafeInteger(location) &&
    Number.isSafeInteger(length) &&
    location >= 0 &&
    length >= 0
    ? { location, length }
    : undefined;
}

export function normalizeProbeSample(
  value: unknown,
): NormalizedProbeSample | null {
  const raw = asRecord(value);
  const app = asRecord(raw?.app);
  const mouse = asRecord(raw?.mouse);
  const selectedText = asRecord(raw?.selected_text);
  const selectedRange = asRecord(raw?.range);
  const boundsResult = asRecord(raw?.bounds);
  const gesture = asRecord(raw?.gesture);
  const sampleId = finiteNumber(raw?.sampleId);

  if (sampleId === null || !Number.isSafeInteger(sampleId) || sampleId < 1) {
    return null;
  }

  const rawText = selectedText?.value;
  const text = typeof rawText === "string" ? rawText : null;
  const sourceApp = typeof app?.name === "string" ? app.name : null;
  const pidValue = finiteNumber(app?.pid);
  const pid =
    pidValue !== null && Number.isSafeInteger(pidValue) && pidValue > 0
      ? pidValue
      : null;
  const rawBundleId = app?.bundle_id;
  const bundleId = typeof rawBundleId === "string" ? rawBundleId : null;
  const capturedUptime = finiteNumber(raw?.captured_at_uptime_seconds);
  const bounds = readBounds(boundsResult?.value);
  const range = readRange(selectedRange?.value);
  const generationValue = finiteNumber(gesture?.generation);
  const gestureGeneration =
    generationValue !== null &&
    Number.isSafeInteger(generationValue) &&
    generationValue > 0
      ? generationValue
      : null;
  const clickCountValue = finiteNumber(gesture?.clickCount);
  const gestureClickCount =
    clickCountValue !== null &&
    Number.isSafeInteger(clickCountValue) &&
    clickCountValue >= 0
      ? clickCountValue
      : 0;
  const gestureDidDrag = gesture?.didDrag === true;
  const maxDragDistanceValue = finiteNumber(gesture?.maxDragDistance);
  const gestureMaxDragDistance =
    maxDragDistanceValue !== null && maxDragDistanceValue >= 0
      ? maxDragDistanceValue
      : 0;
  const gestureIsComplete = gesture?.complete === true;
  const gestureButton = typeof gesture?.button === "string" ? gesture.button : null;
  const gestureIsLeftButton = gestureButton === "left";
  const mousePosition = readPoint(mouse?.position);
  const textIsExact = selectedText?.truncated !== true;
  const textIsUsable =
    text !== null &&
    text.trim().length > 0 &&
    text.length <= MAX_SELECTION_LENGTH &&
    textIsExact;

  return {
    sampleId,
    text,
    sourceApp,
    pid,
    bundleId,
    range,
    bounds,
    mousePosition,
    capturedAt: capturedUptime ?? Date.now() / 1000,
    accessibility:
      typeof raw?.accessibility === "string" ? raw.accessibility : null,
    gestureGeneration,
    gesturePresent: gesture !== null,
    gestureButton,
    gestureClickCount,
    gestureDidDrag,
    gestureMaxDragDistance,
    gestureComplete: gestureIsComplete,
    gestureQualifies:
      gestureGeneration !== null &&
      gestureIsComplete &&
      gestureIsLeftButton &&
      gestureClickCount >= 2,
    usable:
      raw?.usable_selection === true &&
      raw?.stale !== true &&
      raw?.discarded !== true &&
      selectedText?.status === "success" &&
      textIsUsable &&
      sourceApp !== null &&
      sourceApp.trim().length > 0 &&
      pid !== null &&
      mousePosition !== undefined,
    stale: raw?.stale === true,
    discarded: raw?.discarded === true,
  };
}

interface SelfMouseUpProtection {
  selectionId: string;
  windowBounds: Rect;
  expiresAt: number;
}

interface ConsumedSelectionFingerprint {
  selectionId: string;
  text: string;
  sourceApp: string;
  pid: number;
  bundleId: string | null;
  range?: SelectionTextRange;
}

function pointInside(point: Point, bounds: Rect) {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function sameRange(left: SelectionTextRange, right: SelectionTextRange) {
  return (
    left.location === right.location && left.length === right.length
  );
}

export class SelectionSession {
  private currentSnapshot: SelectionSnapshot | null = null;
  private windowSelectionId: string | null = null;
  private selfMouseUpProtection: SelfMouseUpProtection | null = null;
  private consumedSelection: ConsumedSelectionFingerprint | null = null;
  private latestSampleId = 0;
  private latestGestureGeneration = 0;

  constructor(private readonly idFactory: () => string = () => randomUUID()) {}

  get current() {
    return this.currentSnapshot;
  }

  get latestHandledSampleId() {
    return this.latestSampleId;
  }

  diagnosticState(now = Date.now()) {
    const protection = this.selfMouseUpProtection;
    return {
      liveSelectionId: this.currentSnapshot?.selectionId ?? null,
      consumedSelectionId: this.consumedSelection?.selectionId ?? null,
      latestHandledSampleId: this.latestSampleId,
      latestGestureGeneration: this.latestGestureGeneration,
      selfMouseUpProtection:
        protection === null
          ? "none"
          : now <= protection.expiresAt
            ? "active"
            : "expired",
    } as const;
  }

  diagnoseProbe(value: unknown) {
    const sample = normalizeProbeSample(value);
    if (!sample) {
      return {
        usableSelection: false,
        selectedTextLength: 0,
        selectedRange: null,
        gestureGenerationAlreadyConsumed: false,
        gestureQualifies: false,
        qualificationReason: "no_gesture",
        consumedFingerprintMatch: false,
      } as const;
    }

    const generationAlreadyConsumed =
      sample.gestureGeneration !== null &&
      sample.gestureGeneration <= this.latestGestureGeneration;
    const qualificationReason = !sample.gesturePresent ||
      sample.gestureGeneration === null
      ? "no_gesture"
      : !sample.gestureComplete || sample.gestureButton !== "left"
        ? "incomplete"
        : generationAlreadyConsumed
          ? "reused_generation"
          : sample.gestureClickCount >= 2
            ? "double_click"
            : sample.gestureDidDrag
              ? "drag_not_supported_in_pass3"
              : "single_click";

    return {
      usableSelection: sample.usable,
      selectedTextLength: sample.text?.length ?? 0,
      selectedRange: sample.range ?? null,
      gestureGenerationAlreadyConsumed: generationAlreadyConsumed,
      gestureQualifies:
        sample.gestureQualifies && !generationAlreadyConsumed,
      qualificationReason,
      consumedFingerprintMatch: this.isConsumedSelectionReplay(sample),
    } as const;
  }

  handleProbe(value: unknown, now = Date.now()): SessionUpdate {
    const sample = normalizeProbeSample(value);
    if (!sample) return { kind: "ignore", reason: "invalid_probe_record" };

    if (sample.sampleId < this.latestSampleId) {
      return { kind: "ignore", reason: "older_stale_probe_record" };
    }
    if (sample.sampleId === this.latestSampleId) {
      return { kind: "ignore", reason: "duplicate_probe_record" };
    }
    this.latestSampleId = sample.sampleId;
    const hasOneShotFreshGesture =
      sample.gestureQualifies &&
      sample.gestureGeneration !== null &&
      sample.gestureGeneration > this.latestGestureGeneration;
    if (
      sample.gestureGeneration !== null &&
      sample.gestureGeneration > this.latestGestureGeneration
    ) {
      this.latestGestureGeneration = sample.gestureGeneration;
    }

    if (this.isProtectedSelfMouseUp(sample, now)) {
      this.selfMouseUpProtection = null;
      return { kind: "ignore", reason: "button_self_mouse_up" };
    }

    if (sample.stale || sample.discarded) {
      this.clearLiveSelection();
      return { kind: "hide", reason: "stale_probe_record" };
    }

    if (!sample.usable) {
      this.clearLiveSelection();
      return {
        kind: "hide",
        reason:
          sample.accessibility === "permission_required"
            ? "permission_required"
            : "unusable_selection",
      };
    }

    if (
      sample.gestureGeneration !== null &&
      sample.gestureComplete &&
      sample.gestureButton === "left" &&
      sample.gestureClickCount < 2 &&
      sample.gestureDidDrag
    ) {
      this.clearLiveSelection();
      return { kind: "hide", reason: "drag_not_supported_in_pass3" };
    }

    if (!hasOneShotFreshGesture) {
      this.currentSnapshot = null;
      this.windowSelectionId = null;
      this.selfMouseUpProtection = null;
      return this.isConsumedSelectionReplay(sample)
        ? { kind: "ignore", reason: "consumed_selection_replay" }
        : { kind: "hide", reason: "nonqualifying_selection_gesture" };
    }

    const snapshot: SelectionSnapshot = {
      selectionId: this.idFactory(),
      sampleId: sample.sampleId,
      text: sample.text as string,
      sourceApp: sample.sourceApp as string,
      pid: sample.pid as number,
      bundleId: sample.bundleId,
      range: sample.range,
      bounds: sample.bounds,
      mousePosition: sample.mousePosition as Point,
      capturedAt: sample.capturedAt,
      gestureGeneration: sample.gestureGeneration as number,
      consumed: false,
    };
    this.currentSnapshot = snapshot;
    this.windowSelectionId = null;
    this.selfMouseUpProtection = null;
    this.consumedSelection = null;
    return { kind: "show", snapshot };
  }

  associateWindow(selectionId: string) {
    if (
      this.currentSnapshot?.selectionId !== selectionId ||
      this.currentSnapshot.consumed
    ) {
      return false;
    }
    this.windowSelectionId = selectionId;
    return true;
  }

  beginButtonInteraction(
    selectionId: string,
    windowBounds: Rect,
    senderIsValid: boolean,
    now = Date.now(),
  ) {
    if (!this.isLiveSelection(selectionId, senderIsValid)) return false;
    this.selfMouseUpProtection = {
      selectionId,
      windowBounds: { ...windowBounds },
      expiresAt: now + SELF_MOUSE_UP_PROTECTION_MS,
    };
    return true;
  }

  consumeClick(selectionId: string, senderIsValid: boolean) {
    if (!this.isLiveSelection(selectionId, senderIsValid)) return null;
    const snapshot = this.currentSnapshot as SelectionSnapshot;
    const consumedSnapshot = { ...snapshot, consumed: true };
    this.consumedSelection = {
      selectionId: snapshot.selectionId,
      text: snapshot.text,
      sourceApp: snapshot.sourceApp,
      pid: snapshot.pid,
      bundleId: snapshot.bundleId,
      range: snapshot.range ? { ...snapshot.range } : undefined,
    };
    this.currentSnapshot = null;
    this.windowSelectionId = null;
    return consumedSnapshot;
  }

  clear() {
    this.clearLiveSelection();
    this.consumedSelection = null;
  }

  private clearLiveSelection() {
    this.currentSnapshot = null;
    this.windowSelectionId = null;
    this.selfMouseUpProtection = null;
  }

  private isLiveSelection(selectionId: string, senderIsValid: boolean) {
    return (
      senderIsValid &&
      selectionId.length > 0 &&
      this.currentSnapshot?.selectionId === selectionId &&
      this.windowSelectionId === selectionId &&
      !this.currentSnapshot.consumed
    );
  }

  private isProtectedSelfMouseUp(
    sample: NormalizedProbeSample,
    now: number,
  ) {
    const protection = this.selfMouseUpProtection;
    if (!protection) return false;
    if (now > protection.expiresAt) {
      this.selfMouseUpProtection = null;
      return false;
    }
    return (
      sample.mousePosition !== undefined &&
      pointInside(sample.mousePosition, protection.windowBounds)
    );
  }

  private isConsumedSelectionReplay(sample: NormalizedProbeSample) {
    const consumed = this.consumedSelection;
    if (
      consumed === null ||
      sample.text !== consumed.text ||
      sample.sourceApp !== consumed.sourceApp ||
      sample.pid !== consumed.pid ||
      sample.bundleId !== consumed.bundleId
    ) {
      return false;
    }

    if (consumed.range && sample.range) {
      return sameRange(consumed.range, sample.range);
    }

    // Missing AX range cannot prove that an identical AX value is a genuinely
    // new selection. Bounds and mouse position are deliberately excluded from
    // replay identity because Cursor often omits bounds and ordinary clicks
    // move the pointer while re-exposing the same selected text.
    return true;
  }
}
