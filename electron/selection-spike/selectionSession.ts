import { randomUUID } from "node:crypto";
import type { Point, Rect } from "./contracts";
import { isValidPoint, isValidSelectionBounds } from "./position";

const SAMPLE_MARKER = "[selection-probe] sample";
// SelectionProbe emits bounded but detailed metadata for up to 64 AX nodes.
// 256KB keeps that legitimate pretty-printed record bounded without mixing
// unrelated stdout because parsing begins only after the exact sample marker.
export const DEFAULT_MAX_PROBE_RECORD_SIZE = 256 * 1024;
const MAX_SELECTION_LENGTH = 512;
const SELF_MOUSE_UP_PROTECTION_MS = 1_000;

export type ProbeParserEvent =
  | { type: "sample"; value: unknown }
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
      const markerIndex = this.buffer.indexOf(SAMPLE_MARKER);
      if (markerIndex < 0) {
        const retainedLength = Math.min(
          this.buffer.length,
          SAMPLE_MARKER.length - 1,
        );
        this.buffer = this.buffer.slice(-retainedLength);
        break;
      }

      if (markerIndex > 0) this.buffer = this.buffer.slice(markerIndex);

      const jsonStart = this.findJsonStart();
      if (jsonStart < 0) {
        if (Buffer.byteLength(this.buffer, "utf8") > this.maximumRecordSize) {
          events.push({
            type: "overflow",
            reason: "record_buffer_limit",
            observedBytes: Buffer.byteLength(this.buffer, "utf8"),
            limitBytes: this.maximumRecordSize,
          });
          this.buffer = "";
        }
        break;
      }

      const recordEnd = this.findJsonEnd(jsonStart);
      if (recordEnd < 0) {
        const nextMarker = this.buffer.indexOf(
          SAMPLE_MARKER,
          jsonStart + 1,
        );
        if (nextMarker >= 0) {
          events.push({ type: "malformed", reason: "record_interrupted" });
          this.buffer = this.buffer.slice(nextMarker);
          continue;
        }
        if (
          Buffer.byteLength(this.buffer.slice(jsonStart), "utf8") >
          this.maximumRecordSize
        ) {
          events.push({
            type: "overflow",
            reason: "record_buffer_limit",
            observedBytes: Buffer.byteLength(
              this.buffer.slice(jsonStart),
              "utf8",
            ),
            limitBytes: this.maximumRecordSize,
          });
          this.buffer = "";
        }
        break;
      }

      const record = this.buffer.slice(jsonStart, recordEnd + 1);
      this.buffer = this.buffer.slice(recordEnd + 1);

      if (Buffer.byteLength(record, "utf8") > this.maximumRecordSize) {
        events.push({
          type: "overflow",
          reason: "record_buffer_limit",
          observedBytes: Buffer.byteLength(record, "utf8"),
          limitBytes: this.maximumRecordSize,
        });
        continue;
      }

      try {
        events.push({ type: "sample", value: JSON.parse(record) });
      } catch {
        events.push({ type: "malformed", reason: "invalid_json" });
      }
    }

    return events;
  }

  private findJsonStart() {
    let index = SAMPLE_MARKER.length;
    while (index < this.buffer.length && /\s/.test(this.buffer[index])) index += 1;
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
  bounds?: Rect;
  mousePosition?: Point;
  capturedAt: number;
  accessibility: string | null;
  usable: boolean;
  stale: boolean;
  discarded: boolean;
}

export interface SelectionSnapshot {
  selectionId: string;
  sampleId: number;
  text: string;
  sourceApp: string;
  pid: number;
  bundleId: string | null;
  bounds?: Rect;
  mousePosition: Point;
  capturedAt: number;
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

export function normalizeProbeSample(
  value: unknown,
): NormalizedProbeSample | null {
  const raw = asRecord(value);
  const app = asRecord(raw?.app);
  const mouse = asRecord(raw?.mouse);
  const selectedText = asRecord(raw?.selected_text);
  const boundsResult = asRecord(raw?.bounds);
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
    bounds,
    mousePosition,
    capturedAt: capturedUptime ?? Date.now() / 1000,
    accessibility:
      typeof raw?.accessibility === "string" ? raw.accessibility : null,
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

function pointInside(point: Point, bounds: Rect) {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

export class SelectionSession {
  private currentSnapshot: SelectionSnapshot | null = null;
  private windowSelectionId: string | null = null;
  private selfMouseUpProtection: SelfMouseUpProtection | null = null;
  private latestSampleId = 0;

  constructor(private readonly idFactory: () => string = () => randomUUID()) {}

  get current() {
    return this.currentSnapshot;
  }

  get latestHandledSampleId() {
    return this.latestSampleId;
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

    if (this.isProtectedSelfMouseUp(sample, now)) {
      this.selfMouseUpProtection = null;
      return { kind: "ignore", reason: "button_self_mouse_up" };
    }

    if (sample.stale || sample.discarded) {
      this.clear();
      return { kind: "hide", reason: "stale_probe_record" };
    }

    if (!sample.usable) {
      this.clear();
      return {
        kind: "hide",
        reason:
          sample.accessibility === "permission_required"
            ? "permission_required"
            : "unusable_selection",
      };
    }

    const snapshot: SelectionSnapshot = {
      selectionId: this.idFactory(),
      sampleId: sample.sampleId,
      text: sample.text as string,
      sourceApp: sample.sourceApp as string,
      pid: sample.pid as number,
      bundleId: sample.bundleId,
      bounds: sample.bounds,
      mousePosition: sample.mousePosition as Point,
      capturedAt: sample.capturedAt,
      consumed: false,
    };
    this.currentSnapshot = snapshot;
    this.windowSelectionId = null;
    this.selfMouseUpProtection = null;
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
    snapshot.consumed = true;
    this.windowSelectionId = null;
    return { ...snapshot };
  }

  clear() {
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
      protection.selectionId === this.currentSnapshot?.selectionId &&
      sample.mousePosition !== undefined &&
      pointInside(sample.mousePosition, protection.windowBounds)
    );
  }
}
