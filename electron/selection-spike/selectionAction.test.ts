import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_WINDOW_SIZE,
  MOUSE_FALLBACK_HORIZONTAL_OFFSET,
  calculateActionPosition,
  isValidSelectionBounds,
} from "./position";
import { ProbeSampleParser, SelectionSession } from "./selectionSession";

function probeSample(
  sampleId: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    sampleId,
    captured_at_uptime_seconds: 123.5,
    app: { name: "TextEdit", pid: 321, bundle_id: "com.apple.TextEdit" },
    mouse: { position: { x: 180, y: 120 } },
    accessibility: "trusted",
    selected_text: {
      status: "success",
      value: "component",
      nonempty: true,
      truncated: false,
    },
    bounds: {
      status: "success",
      value: { x: 100, y: 100, width: 70, height: 20 },
    },
    usable_selection: true,
    stale: false,
    discarded: false,
    ...overrides,
  };
}

function encodedSample(value: unknown) {
  return `[selection-probe] sample\n${JSON.stringify(value, null, 2)}\n`;
}

test("parser reconstructs one complete multi-line sample", () => {
  const parser = new ProbeSampleParser();
  const encoded = encodedSample(probeSample(1));
  const midpoint = Math.floor(encoded.length / 2);
  assert.deepEqual(parser.push(encoded.slice(0, midpoint)), []);
  const events = parser.push(encoded.slice(midpoint));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "sample");
});

test("parser reports malformed balanced JSON", () => {
  const parser = new ProbeSampleParser();
  const events = parser.push('[selection-probe] sample\n{"sampleId":}\n');
  assert.deepEqual(events, [{ type: "malformed", reason: "invalid_json" }]);
});

test("parser rejects records over its configured buffer limit", () => {
  const parser = new ProbeSampleParser(64);
  const events = parser.push(
    `[selection-probe] sample\n{"value":"${"x".repeat(100)}`,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "overflow");
  assert.equal(
    events[0].type === "overflow" ? events[0].limitBytes : null,
    64,
  );
  assert.ok(
    events[0].type === "overflow" && events[0].observedBytes > 64,
  );
});

test("default parser accepts a bounded diagnostic record larger than 64KB", () => {
  const parser = new ProbeSampleParser();
  const events = parser.push(
    encodedSample({ sampleId: 1, traversal: ["x".repeat(70 * 1024)] }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "sample");
});

test("older stale samples cannot clear a newer live snapshot", () => {
  let id = 0;
  const session = new SelectionSession(() => `selection-${++id}`);
  assert.equal(session.handleProbe(probeSample(4)).kind, "show");
  assert.deepEqual(
    session.handleProbe(probeSample(3, { stale: true })),
    { kind: "ignore", reason: "older_stale_probe_record" },
  );
  assert.equal(session.current?.sampleId, 4);
});

test("a new usable selection replaces the previous snapshot", () => {
  let id = 0;
  const session = new SelectionSession(() => `selection-${++id}`);
  const first = session.handleProbe(probeSample(1));
  const second = session.handleProbe(
    probeSample(2, {
      selected_text: {
        status: "success",
        value: "dependency",
        nonempty: true,
        truncated: false,
      },
    }),
  );
  assert.equal(first.kind, "show");
  assert.equal(second.kind, "show");
  assert.equal(session.current?.text, "dependency");
  assert.equal(session.current?.selectionId, "selection-2");
});

test("empty selections are rejected and clear the current snapshot", () => {
  const session = new SelectionSession(() => "selection-1");
  session.handleProbe(probeSample(1));
  const update = session.handleProbe(
    probeSample(2, {
      usable_selection: false,
      selected_text: {
        status: "success",
        value: "",
        nonempty: false,
        truncated: false,
      },
    }),
  );
  assert.deepEqual(update, { kind: "hide", reason: "unusable_selection" });
  assert.equal(session.current, null);
});

test("usable selection is live until the next unusable sample clears it", () => {
  const session = new SelectionSession(() => "selection-1");
  const shown = session.handleProbe(probeSample(1));
  assert.equal(shown.kind, "show");
  assert.equal(session.associateWindow("selection-1"), true);
  assert.equal(session.current?.selectionId, "selection-1");

  const hidden = session.handleProbe(
    probeSample(2, {
      usable_selection: false,
      selected_text: {
        status: "success",
        value: "",
        nonempty: false,
        truncated: false,
      },
    }),
  );
  assert.deepEqual(hidden, { kind: "hide", reason: "unusable_selection" });
  assert.equal(session.current, null);
});

test("ordinary mouse-up after invalidation cannot re-show the button", () => {
  const session = new SelectionSession(() => "selection-1");
  session.handleProbe(probeSample(1));
  session.handleProbe(
    probeSample(2, {
      usable_selection: false,
      selected_text: {
        status: "success",
        value: "",
        nonempty: false,
        truncated: false,
      },
    }),
  );
  const ordinaryMouseUp = session.handleProbe(
    probeSample(3, {
      usable_selection: false,
      selected_text: {
        status: "not_queried",
        value: null,
        nonempty: false,
        truncated: false,
      },
      bounds: { status: "not_queried", value: null },
    }),
  );
  assert.deepEqual(ordinaryMouseUp, {
    kind: "hide",
    reason: "unusable_selection",
  });
  assert.equal(session.current, null);
});

test("an older selection record cannot reappear after invalidation", () => {
  let id = 0;
  const session = new SelectionSession(() => `selection-${++id}`);
  const original = session.handleProbe(probeSample(1));
  assert.equal(original.kind, "show");
  session.handleProbe(
    probeSample(2, {
      usable_selection: false,
      selected_text: {
        status: "success",
        value: "",
        nonempty: false,
        truncated: false,
      },
    }),
  );

  assert.deepEqual(session.handleProbe(probeSample(1)), {
    kind: "ignore",
    reason: "older_stale_probe_record",
  });
  assert.equal(session.current, null);
  assert.equal(session.associateWindow("selection-1"), false);
});

test("mouse position alone cannot create a selection snapshot", () => {
  const session = new SelectionSession(() => "selection-1");
  const update = session.handleProbe(
    probeSample(1, {
      usable_selection: true,
      selected_text: {
        status: "not_queried",
        value: null,
        nonempty: false,
        truncated: false,
      },
      bounds: { status: "not_queried", value: null },
    }),
  );
  assert.deepEqual(update, { kind: "hide", reason: "unusable_selection" });
  assert.equal(session.current, null);
});

test("a cached visible id is not replayable after invalidation", () => {
  const session = new SelectionSession(() => "selection-1");
  const shown = session.handleProbe(probeSample(1));
  assert.equal(shown.kind, "show");
  const cachedVisibleId =
    shown.kind === "show" ? shown.snapshot.selectionId : null;

  session.handleProbe(
    probeSample(2, {
      usable_selection: false,
      selected_text: {
        status: "success",
        value: "",
        nonempty: false,
        truncated: false,
      },
    }),
  );

  const replayable =
    session.current !== null &&
    session.current.selectionId === cachedVisibleId &&
    !session.current.consumed;
  assert.equal(replayable, false);
});

test("an authoritative stale sample clears a live selection", () => {
  const session = new SelectionSession(() => "selection-1");
  session.handleProbe(probeSample(1));
  assert.deepEqual(
    session.handleProbe(probeSample(2, { stale: true })),
    { kind: "hide", reason: "stale_probe_record" },
  );
  assert.equal(session.current, null);
});

test("bounds validation rejects zero, huge, and off-screen rectangles", () => {
  const workArea = { x: 0, y: 0, width: 1200, height: 800 };
  assert.equal(
    isValidSelectionBounds({ x: 20, y: 20, width: 0, height: 20 }, workArea),
    false,
  );
  assert.equal(
    isValidSelectionBounds({ x: 0, y: 0, width: 1150, height: 20 }, workArea),
    false,
  );
  assert.equal(
    isValidSelectionBounds({ x: 2000, y: 20, width: 20, height: 20 }, workArea),
    false,
  );
});

test("mouse fallback prefers above-right of the captured mouse-up point", () => {
  const result = calculateActionPosition({
    selectionBounds: { x: 100, y: 100, width: 0, height: 0 },
    mousePosition: { x: 200, y: 150 },
    workArea: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(result.anchorSource, "mouse_position");
  assert.equal(result.placement, "above_right");
  assert.equal(result.x, 200 + MOUSE_FALLBACK_HORIZONTAL_OFFSET);
  assert.equal(
    result.y,
    150 - ACTION_WINDOW_SIZE - 3,
  );
});

test("mouse fallback keeps the window clear of the mouse-up text line", () => {
  const mousePosition = { x: 200, y: 150 };
  const result = calculateActionPosition({
    mousePosition,
    workArea: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(
    result.y + ACTION_WINDOW_SIZE,
    mousePosition.y - 3,
  );
});

test("right-edge mouse fallback flips to above-left", () => {
  const result = calculateActionPosition({
    mousePosition: { x: 780, y: 300 },
    workArea: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(result.anchorSource, "mouse_position");
  assert.equal(result.placement, "above_left");
  assert.equal(result.flipped, true);
  assert.equal(
    result.x,
    780 - MOUSE_FALLBACK_HORIZONTAL_OFFSET - ACTION_WINDOW_SIZE,
  );
});

test("top-edge mouse fallback moves below the mouse-up point", () => {
  const result = calculateActionPosition({
    mousePosition: { x: 100, y: 20 },
    workArea: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(result.placement, "below_right");
  assert.equal(result.y, 20 + 3);
});

test("positioning flips to the left at the right work-area edge", () => {
  const result = calculateActionPosition({
    selectionBounds: { x: 730, y: 100, width: 60, height: 20 },
    mousePosition: { x: 790, y: 110 },
    workArea: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(result.flipped, true);
  assert.equal(result.x, 692);
});

test("mouse fallback clamps the window inside the work area", () => {
  const result = calculateActionPosition({
    mousePosition: { x: -20, y: -10 },
    workArea: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
  assert.ok(result.x + ACTION_WINDOW_SIZE <= 800);
  assert.ok(result.y + ACTION_WINDOW_SIZE <= 600);
});

test("a consumed selection rejects duplicate clicks", () => {
  const session = new SelectionSession(() => "opaque-1");
  const update = session.handleProbe(probeSample(1));
  assert.equal(update.kind, "show");
  assert.equal(session.associateWindow("opaque-1"), true);
  assert.ok(session.consumeClick("opaque-1", true));
  assert.equal(session.consumeClick("opaque-1", true), null);
});

test("a replaced selection rejects clicks for the stale id", () => {
  let id = 0;
  const session = new SelectionSession(() => `opaque-${++id}`);
  session.handleProbe(probeSample(1));
  session.associateWindow("opaque-1");
  session.handleProbe(probeSample(2));
  session.associateWindow("opaque-2");
  assert.equal(session.consumeClick("opaque-1", true), null);
  assert.ok(session.consumeClick("opaque-2", true));
});

test("button mouse-up is ignored only inside the protected window", () => {
  const session = new SelectionSession(() => "opaque-1");
  session.handleProbe(probeSample(1));
  session.associateWindow("opaque-1");
  assert.equal(
    session.beginButtonInteraction(
      "opaque-1",
      { x: 170, y: 110, width: 36, height: 36 },
      true,
      100,
    ),
    true,
  );
  const update = session.handleProbe(
    probeSample(2, {
      usable_selection: false,
      mouse: { position: { x: 180, y: 120 } },
    }),
    150,
  );
  assert.deepEqual(update, { kind: "ignore", reason: "button_self_mouse_up" });
  assert.equal(session.current?.selectionId, "opaque-1");
});
