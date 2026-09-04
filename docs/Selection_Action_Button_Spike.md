# Selection Action Button v1.1 — Isolated Electron Spike

## Purpose and experiment boundary

This spike connects the existing standalone macOS `SelectionProbe` output to the approved React Selection Action Button. It proves only:

```text
real text selection
→ public Accessibility probe reports a usable selection
→ isolated Electron window shows the action button
→ click is validated against the current in-memory snapshot
→ local diagnostic is printed
→ button hides
```

It does **not** call the Backend or AI, open the translator popover, use production Electron IPC, read or modify the clipboard, or change the production `npm start` flow. Selected text is retained only in process memory and is never persisted or sent over the network.

## Architecture

- `native/SelectionProbe.m` remains the selection source. The experiment launches its compiled binary in default mode and consumes stdout without changing native selection-reading logic.
- `ProbeSampleParser` reconstructs pretty-printed JSON after the `[selection-probe] sample` marker. It supports split chunks, strings containing braces, malformed records, and a 256KB maximum record buffer. The probe can emit more than 64KB of bounded traversal metadata for its maximum 64 AX nodes; unrelated stdout before the exact sample marker is still discarded.
- `SelectionSession` accepts only non-stale, non-discarded, exact, non-empty usable selections. It retains an independent monotonically increasing sample high-water mark so an older record cannot reappear after invalidation. It creates an opaque UUID and keeps the selected text, source app, PID, bundle ID, bounds, captured mouse-up position, and capture time only in the main process.
- The renderer receives only `{ visible, selectionId }`. Its preload exposes only `ready()`, `onState()`, `pointerDown(selectionId)`, and `click(selectionId)` on experiment-specific IPC channels.
- One reusable 36×36 transparent BrowserWindow contains the 32×32 hit region plus 2px rendering allowance on each side. The visible surface remains 28×28. Native shadow is disabled so only the approved CSS shadow renders.

## Frozen visual design

- Visible surface: 28×28px; hit area: 32×32px; radius: 7px.
- Icon: 14px, one four-point sparkle using `M12 2L13.8 10.2L22 12L13.8 13.8L12 22L10.2 13.8L2 12L10.2 10.2Z`.
- Default: `#F5F1FF` / `#6F4BC3` / `#E4DEF2`.
- Hover: `#EDE6FD` / `#5F3BAE` / `#D6CCED`.
- Pressed: `#E5DCFB` / `#542F9E`, without scale.
- Shadow: `0 1px 2px rgba(0,0,0,.03), 0 2px 5px -1px rgba(111,75,195,.06)`.
- Visible gap from selection: 6px. Entrance is opacity plus 3px translateY over 160ms; exit style is a 120ms opacity fade. Reduced motion and `aria-label="翻译选中文本"` remain supported.

## Probe parsing and snapshot lifecycle

Startup and other log lines are ignored. A sample record is accepted only after a balanced JSON object has been reconstructed and parsed. Malformed and oversized records fail closed: they produce local diagnostics, invalidate the live snapshot, send `visible:false`, and hide the BrowserWindow.

A new usable sample replaces the previous snapshot and repositions the same window. An unusable current sample, a newer stale/discarded sample, missing Accessibility permission, or a changed source context reported through a new mouse-up hides the window. An older stale result cannot clear a newer snapshot or be replayed after invalidation. Renderer load/readiness without a live snapshot always replays `visible:false`, never a cached visible state. A click consumes the current ID once; duplicate and replaced-ID clicks are rejected.

Selected text is capped by the probe and rejected when the logged value is truncated, because a partial selection is not an exact snapshot. Renderer input can never supply selected text, source app, executable paths, or URLs.

## Positioning and fallback

1. Use finite, positive selection bounds when they intersect the selected display's work area and are not implausibly large.
2. With valid bounds, preserve the approved layout: place the visible 28px surface 6px to the right of the selection, vertically center it, flip left at the right edge, and clamp the full 36px experiment window into the display work area.
3. Otherwise use the cursor position captured by the original mouse-up sample. Never read the current cursor position later or fabricate selection bounds.
4. Mouse fallback uses separate explicit geometry: prefer above-right with an 8px horizontal offset and a 3px vertical gap between the 36px window bottom and the mouse-up point.
5. If above-right does not fit horizontally, use above-left. If above does not fit vertically, use the corresponding below-right or below-left placement. Clamp the final 36px window into the display work area.

This spike intentionally has no complex multiline selection heuristic. AX and Electron coordinates are currently treated as global top-left display values without speculative scaling or Y-axis conversion. The TextEdit invisibility bug occurred before positioning—the sandboxed preload never established IPC—so coordinate conversion was not added without a real raw-bounds mismatch. The diagnostic log now includes raw bounds, mouse point, Electron display scale/work area, requested bounds, and actual read-back bounds. Retina and external-monitor plausibility must be verified manually before adding any conversion.

## Renderer readiness and visibility diagnostics

The experimental window keeps its latest renderer state but does not call `showInactive()` until both `did-finish-load` and the preload's `ready()` event have occurred. A sandbox-compatible preload keeps runtime IPC channel strings in its single compiled file; only TypeScript types are imported from the shared contract. This avoids a local CommonJS `require`, which Electron's sandboxed preload cannot load.

For each accepted selection the terminal records the renderer URL, loaded/ready flags, whether state delivery occurred, raw geometry, display/work area, requested and actual BrowserWindow bounds, opacity, and native visibility. The renderer separately reports its 32×32 DOM bounds and opacity at mount and after the 160ms entrance animation.

## Self-mouse-up protection

The floating button's `pointerdown` sends only the current opaque ID. Main validates the sender, ID, current snapshot, and window association, then arms a one-second protection limited to the button window's 36×36 bounds. The next probe sample is ignored only when its captured mouse-up point falls inside those bounds. A genuine selection outside the button is not suppressed and replaces or clears the prior snapshot.

The subsequent click is independently validated and consumed once. It prints a local diagnostic with an 80-character, single-line representation of the selected test text and app, then hides the window. It never starts translation.

## Permission behavior

The experiment does not request Accessibility permission and never opens System Settings. If the probe reports `permission_required`, no button is shown, a clear terminal diagnostic is printed, and observation continues safely. Permission must be granted manually to the Electron experiment if macOS requires a separate trusted executable entry.

## Commands

Run isolated tests:

```bash
npm run test:selection-action
```

Build and launch only the experiment:

```bash
npm run spike:selection-action
```

Stop it with `Ctrl+C`. This command builds the Vite entries, experiment TypeScript, and SelectionProbe binary, then launches `dist-electron/selection-spike/main.js`; it does not run the package's production main entry.

## Manual QA matrix

Use non-sensitive English fixture text and test only applications already reported compatible with the probe:

| App / surface | Probe status | PASS 2 action-button status |
| --- | --- | --- |
| TextEdit plain text | Pass | PASS |
| Chrome ordinary webpage body | Pass | PASS |
| Cursor editor | Pass | PASS |
| Notion text block | Pass | PASS |
| Figma text-editing mode | Inconclusive | Experimental / pending; not part of PASS 2 acceptance |

For each supported surface:

1. Select one English word and verify exactly one approved v1.1 button appears without covering the highlight.
2. Verify placement, hover, pressed feedback, and that the source app remains effectively active.
3. Click once and confirm the terminal reports the correct sample, word, and app; the button must hide.
4. Make a new selection and confirm the old window is replaced, not duplicated.
5. Clear the selection and confirm the button hides.
6. Try rapid replacement and confirm stale samples and old IDs cannot act.
7. Verify the transparent rendering allowance does not create a meaningful click-blocking area.
8. Repeat near the right/top/bottom edges and on an external display if available.

## Known limitations

- Figma remains experimental; targeted-container probe mode is not launched by this command.
- The probe is mouse-up driven. Keyboard-only selection changes, application switches without a subsequent observed mouse-up, and scroll-driven geometry changes are not continuously monitored.
- Multiline AX bounds can describe an enclosing rectangle rather than the final visual line; this pass does not infer line fragments.
- Electron transparency, first-click behavior, permission identity, focus preservation, and multi-monitor coordinate accuracy require real macOS manual QA.
- There is no AI, Backend, Retry, Offline, clipboard, production popover, or automatic recovery integration in this spike.
