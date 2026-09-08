# Selection Action Button v1.1 — Selection Trigger Integration Spike

## Purpose and experiment boundary

PASS 2 connects the standalone macOS `SelectionProbe` output to the approved React Selection Action Button. The isolated command proves:

```text
real text selection
→ public Accessibility probe reports a usable selection
→ isolated Electron window shows the action button
→ click is validated against the current in-memory snapshot
→ local diagnostic is printed
→ button hides
```

The isolated `spike:selection-action` command does **not** call the Backend or AI, open the translator popover, read or modify the clipboard, or start the production app. Selected text is retained only in process memory and is never persisted by the Selection Action layer.

PASS 3 reuses that proven controller in production. A valid, consumed single-word selection is converted to the existing in-memory AI request snapshot and sent through the same Backend request lifecycle as a clipboard-triggered word. Clipboard triggering remains enabled and unchanged.

PASS 3 production mouse eligibility is deliberately limited to a fresh completed double-click (`clickCount >= 2`) that yields one usable ASCII English word. Drag selection, keyboard selection, phrases, and multi-word selections are deferred. The native probe continues collecting drag diagnostics for later investigation, but drag data does not make a PASS 3 selection actionable.

## Architecture

- `native/SelectionProbe.m` remains the selection source. A public, listen-only Core Graphics event tap observes left mouse-down, left-mouse-dragged, and left mouse-up without intercepting or modifying them. Each AX query sample carries one gesture generation, click count, honest `didDrag` evidence, the maximum Euclidean excursion from mouse-down across every dragged event, and the captured mouse-up position.
- `ProbeSampleParser` reconstructs pretty-printed JSON after the `[selection-probe] sample` marker. It supports split chunks, strings containing braces, malformed records, and a 256KB maximum record buffer. The probe can emit more than 64KB of bounded traversal metadata for its maximum 64 AX nodes; unrelated stdout before the exact sample marker is still discarded.
- `electron/selection/SelectionActionController.ts` owns the probe process, parser, selection session, action BrowserWindow, positioning, narrow IPC validation, one-shot click consumption, and shutdown cleanup. Both the isolated PASS 2 app and production use this controller; they never run together in one Electron process.
- `SelectionSession` accepts only non-stale, non-discarded, exact, non-empty usable selections that belong to a new completed left-button gesture generation with click count 2 or greater. `didDrag` and `maxDragDistance` remain honest native diagnostics, including the earlier four-point experimental threshold, but no `clickCount=1` drag is production-actionable in PASS 3. It retains independent sample and gesture-generation high-water marks so neither an older AX result nor a reused gesture token can become actionable. It creates an opaque UUID and keeps the selected text, source app, PID, bundle ID, range, bounds, captured mouse-up position, and capture time only in the main process.
- The renderer receives only `{ visible, selectionId }`. Its preload exposes only `ready()`, `onState()`, `pointerDown(selectionId)`, and `click(selectionId)` on experiment-specific IPC channels.
- One reusable 36×36 transparent BrowserWindow contains the 32×32 hit region plus 2px rendering allowance on each side. The visible surface remains 28×28. Native shadow is disabled so only the approved CSS shadow renders.

## PASS 3 production request boundary

Production now has two input paths that converge on one request lifecycle:

```text
Clipboard Trigger
clipboard word → shared production translation request lifecycle → Translator Popover

Selection Trigger
double-click one English word → Selection Action Button ✦ → click
→ trusted SelectionSnapshot → shared production translation request lifecycle
→ Translator Popover
```

The renderer continues to send only an opaque `selectionId`. After main-process sender and live-session validation, the controller consumes and hides the button, then delivers its authoritative snapshot to production. Production:

1. trims only leading and trailing whitespace;
2. accepts only `/^[A-Za-z]+$/`, preserving the selected word's original case;
3. uses the captured source application without re-detecting the foreground app;
4. derives the translator anchor from valid selection bounds, otherwise from the captured mouse-up point;
5. allocates a new AI `requestId` and runs the existing Loading → Result/Error/Offline path.

The selection UUID/sample ID and AI request ID remain separate. Clipboard and selection triggers share `RequestSnapshot`, `latestAIRequestId`, one `AbortController`, stale-response protection, the Backend request path, Loading/Result/Error/Offline states, Retry, request-specific dismissal protection, and the same Translator Popover. Whichever trigger starts later supersedes the older request. A valid clipboard request also invalidates and hides an unconsumed Selection Action Button. Retry preserves the exact failed request snapshot, including a selection-derived source app and anchor.

Selections containing spaces, punctuation, digits, line breaks after trimming, or no remaining characters are rejected before any Backend request. No preview, probe, or renderer payload can supply the Backend URL, user goal, selected text, or application context.

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

A new usable sample replaces the previous snapshot and repositions the same window only when its one-shot gesture generation proves a fresh completed double/triple click. An ordinary single click and every `clickCount=1` drag—including tiny jitter, a substantial incidental drag, or an actual text drag—remain non-actionable and hide the Selection Action Button with `drag_not_supported_in_pass3` where applicable. `didDrag` continues to mean that at least one dragged event occurred, and `maxDragDistance` remains available for diagnostics and future work. An unusable current sample, a newer stale/discarded sample, missing Accessibility permission, or a nonqualifying gesture clears only the live actionable selection and hides the window.

A click consumes the current ID once, clears the live selection immediately, and retains a separate replay-suppression fingerprint made from selected text, source app, PID, bundle ID, and the public AX selected-text range when available. Empty, unusable, stale, bounds-less, mouse-only, ordinary single-click, and drag samples do not clear that fingerprint. A fresh double-click may intentionally re-arm an identical fingerprint. Drag-trigger qualification was deferred because current public AX evidence was insufficiently reliable to distinguish fresh drag-text selection from stale selection exposure across tested surfaces. This is a PASS 3 product-scope decision, not a claim that public AX can never support drag selection. An older AX result, reused gesture generation, duplicate click, or replaced ID cannot become actionable. Renderer load/readiness without a live snapshot always replays `visible:false`, never a cached visible state.

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

The floating button's `pointerdown` sends only the current opaque ID. Main validates the sender, ID, current snapshot, and window association, then arms a one-second protection limited to the button window's 36×36 bounds. The next probe sample is ignored only when its captured mouse-up point falls inside those bounds. Its gesture generation is still consumed and cannot qualify a later sample. A genuine double-click outside the button may reselect the same fingerprint. An ordinary click or drag outside clears live state without reviving stale AX text and cannot create a new PASS 3 action.

The subsequent click is independently validated and consumed once, then hides the button window. In the isolated PASS 2 command, the callback prints only a bounded local diagnostic and never starts translation. In production PASS 3, the callback passes the authoritative snapshot into the shared translation request lifecycle; the renderer cannot supply the word, source app, user goal, or Backend URL.

## Permission behavior

Neither mode requests Accessibility or Input Monitoring permission and neither opens System Settings. The AX path still requires Accessibility trust. The listen-only Core Graphics event tap may additionally require macOS Input Monitoring approval for the responsible development executable. Startup reports both the listen-access preflight and whether the event tap was created. If the event tap is unavailable, counter polling continues for diagnostics but emits `complete:false` gestures, so no Selection Action Button is shown without proven intent. The production clipboard trigger remains available.

## Commands

Run isolated tests:

```bash
npm run test:selection-action
```

The native maximum-excursion regression check can be run after compiling the probe:

```bash
dist-native/selection-probe --self-test-gesture-distance
```

Build and launch only the experiment:

```bash
npm run spike:selection-action
```

Stop it with `Ctrl+C`. This command builds the Vite entries, experiment TypeScript, and SelectionProbe binary, then launches `dist-electron/selection-spike/main.js`; it does not run the package's production main entry.

For PASS 3 production QA, start the Backend in one Terminal and Electron in another:

```bash
cd server
AI_PROVIDER=mock npm start
```

```bash
npm start
```

The regular production build now compiles `SelectionProbe` alongside the existing native helpers. Production starts exactly one controller after Electron is ready and stops its probe during `will-quit`.

## Manual QA matrix

Use non-sensitive English fixture text and test only applications already reported compatible with the probe:

| App / surface | Probe status | PASS 2 action button | PASS 3 production E2E |
| --- | --- | --- | --- |
| TextEdit plain text | Pass | PASS | PASS |
| Chrome ordinary webpage body | Pass | PASS | PASS |
| Cursor editor | Pass | PASS | PASS |
| Notion text block | Pass | PASS | PASS |
| Figma text-editing mode | Inconclusive | Experimental / pending | Experimental / pending; not part of PASS 3 acceptance |

For each supported surface:

1. Double-click one ASCII English word and verify exactly one approved v1.1 button appears without covering the highlight.
2. Verify placement, hover, pressed feedback, and that the source app remains effectively active.
3. Click once and confirm the terminal reports the correct sample, word, and app; the button must hide.
4. Make a new selection and confirm the old window is replaced, not duplicated.
5. Clear the selection and confirm the button hides.
6. Try rapid replacement and confirm stale samples and old IDs cannot act.
7. Verify the transparent rendering allowance does not create a meaningful click-blocking area.
8. Repeat near the right/top/bottom edges and on an external display if available.

## Known limitations

- Figma remains experimental; targeted-container probe mode is not launched by this command.
- PASS 3 production gesture qualification intentionally supports only completed mouse-driven double/triple-click for a single ASCII English word. Drag selection, keyboard-only selection, Shift+click, phrases, multi-word selections, and arbitrary text spans are deferred.
- Multiline AX bounds can describe an enclosing rectangle rather than the final visual line; this pass does not infer line fragments.
- Electron transparency, first-click behavior, permission identity, focus preservation, and multi-monitor coordinate accuracy require real macOS manual QA.
- The isolated PASS 2 command intentionally has no AI/Backend integration. PASS 3 production integration completed manual E2E acceptance in TextEdit, Chrome, Cursor, and Notion.
- Selection remains limited to one ASCII English word. Phrases, hyphenated words, apostrophes, digits, and multiline selections are intentionally rejected in this pass.
- A fresh double-click may immediately reselect the same consumed word and AX range. Every drag-only gesture remains unsupported in PASS 3, even when it crosses a different word or range; users can trigger supported single-word translation by double-clicking. No timer, mouse-position identity, threshold increase, or pointer heuristic is used to weaken this rule.
