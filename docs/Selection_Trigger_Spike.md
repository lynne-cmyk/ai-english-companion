# Phase 2B — Selection Trigger Spike: Probe Only

## Purpose and scope

Determine whether a frontmost macOS application exposes selected text, a selected range, and selection bounds after a left mouse-up. These are three independent capabilities, not one compatibility result.

This is a standalone Objective-C command-line probe. It does not launch Electron, create an icon/window, call the Backend/DeepSeek, use the network, read or write the clipboard, simulate Cmd+C, perform OCR, or change the existing product. It now performs strictly bounded Accessibility navigation when the focused-element path has no usable selected text. It never scans an entire application tree or enables accessibility modes in other apps. Clipboard-triggered translation remains untouched.

**Current experiment: optional targeted container-local selection probing, intended for the unresolved Figma text-editing case. This new mode has not yet passed real Figma manual QA. A compile or mocked test is not compatibility evidence.**

Latest user-reported manual compatibility: **TextEdit PASS; Chrome normal webpage body PASS; Cursor PASS; Notion PASS.** Figma actual text-editing selections (`Popover`, `Skeleton`) have not yet passed. The reported sample had `usable_selection=false` and `window_depth_limit_reached=true`. This is an inconclusive bounded-search result, not proof that Figma lacks public selected-text accessibility. App versions and per-action/per-capability results beyond those explicitly reported should still be recorded during QA.

Previous focused-only probe results, reported by the user:

- TextEdit: frontmost app, focused element, selected text, range and bounds succeeded.
- Chrome address bar: focused `AXTextField` and selected URL text succeeded; range/bounds were not confirmed.
- Chrome webpage body: app detection and trust succeeded, but `AXFocusedUIElement` returned `kAXErrorNoValue`; selection APIs were not reached.

These earlier observations explain why the default public fallback was added; the newer compatibility summary above supersedes the earlier Chrome-body failure. They do not establish acceptance of targeted mode.

## Architecture

1. A public Core Graphics event tap uses `kCGEventTapOptionListenOnly` to observe left mouse-down, left-mouse-dragged, and left mouse-up. It never intercepts, posts, changes, or suppresses an event. Public event fields provide the exact event point, mouse button number, `kCGMouseEventClickState`, direct evidence that a dragged event occurred between down and up, and the maximum Euclidean distance from mouse-down to every observed dragged position.
2. Each completed down/up gesture gets a monotonically increasing gesture generation and sample ID, app name/PID/bundle identifier, uptime timestamp, captured mouse-up position, click count, `didDrag`, and `maxDragDistance`. `didDrag` remains true whenever any dragged event occurred, and the maximum excursion remains measured in unscaled macOS global points. PASS 3 production eligibility now requires click count 2+; drag measurements—including the earlier four-point experimental threshold—remain diagnostic-only for future phrase/arbitrary-span work. Counter polling remains only as a fail-closed diagnostic fallback if the listen-only event tap cannot be created; those fallback samples have `gesture.complete=false` and cannot qualify a Selection Action.
3. Wait 75ms by default for the target app to update its selection. A newer sample replaces a pending older one. The delay is adjustable with `--delay-ms` (10–1000ms); 50–100ms is the initial experimental range.
4. Check that the captured app is still frontmost, then run AX calls on a separate serial queue. Only one query and one latest pending sample are retained. Slow AX calls cannot block mouse sampling or Ctrl+C processing.
5. Silently check `AXIsProcessTrusted()`. If false, print `permission_required`, leave text/range/bounds as `not_queried`, and continue observing safely.
6. Set `AXUIElementSetMessagingTimeout()` to 200ms using the system-wide element. This setting is local to the probe process, not the production app or AI requests. Fail closed if timeout setup fails. Also enforce an 800ms total query budget, starting after the settling delay. Before every AX messaging operation, check the deadline, raw mouse-up counter, frontmost app and stop signal. A call already in flight can overrun the deadline by its messaging timeout; no subsequent call starts. This is not a hard real-time guarantee against an OS failure.
7. Preserve the original `AXUIElementCreateApplication(pid)` → `kAXFocusedUIElementAttribute` path. A nonempty selected text result finishes selection discovery; missing range/bounds alone do not trigger a different candidate. Empty/unsupported text or unavailable focus permits fallback. Secure or unverifiable focused fields still fail closed.
8. Fallback A: use `AXUIElementCopyElementAtPosition()` on the captured application with the captured mouse-up coordinates. Never sample the mouse again for this query. Validate the returned element's Core Foundation type and owner PID. Inspect only role/subrole; title and description are intentionally omitted because they can contain sensitive window/page/document text.
9. Fallback B: test reasonable candidates on the hit element and at most 8 parents. Stop at a window, cycle, unsafe element, or query limit. Plausible roles include browser-reported `AXWebArea`, standard groups/scroll areas/layout areas, text fields/text areas/static text, and windows. `AXWebArea` is only a role-value comparison; no private attribute is queried.
10. Default fallback C: if no usable text was found, get `AXFocusedWindow`, or `AXMainWindow` when unavailable, from the same application. Breadth-first search only that window's public `AXContents` / `AXChildren` relationships, with depth 7, at most 64 queued nodes, cycle/duplicate detection, and 8-element child batches. Never enumerate `AXWindows`, descend into another window, or fetch a complete children array. At most the first 64 entries of an individual relationship are examined; truncation is diagnostic, not proof of no selection. **Only with `--target-container`, this stage is replaced by the local-container experiment described below. There is no subsequent broad-window fallback in that mode.**
11. Every distinct inspected node, across all paths combined, counts toward a 64-node sample limit. Verify each node's PID and security metadata before selection reads or child expansion. Unsafe window-search branches are skipped; unsafe hit/parent targets stop fallback entirely, preventing reads through a secure target's ancestors. Cache metadata/probed identities only within this sample, never across clicks or tabs.
12. For each reasonable candidate, read **only** `kAXSelectedTextAttribute`, `kAXSelectedTextRangeAttribute`, and (if range is valid/nonempty) `kAXBoundsForRangeParameterizedAttribute`. Validate `AXValue` types before unpacking `CFRange`/`CGRect`. Text, range and bounds come from the **same candidate**, never combined from different elements. Never read full-document `kAXValueAttribute` or use private text-marker attributes.
13. On completion, compare `sampleId` with the latest sample and re-check the frontmost app and raw mouse-up counter before printing. Preserve an app-change/superseded reason detected partway through the query even if the app switches back. Discard stale text/range/bounds before printing. Candidate-attempt diagnostics contain status/error metadata only, never copies of selected text. No results are delivered to the production app.

The probe does not guarantee an atomic selection snapshot: a target can change its selection, tab or focus without another mouse-up. Per-operation app checks cannot detect switching away and back entirely between checks. Owning-PID validation prevents intentionally combining a different process's element with the captured app. A browser may retain hidden/offscreen selections inside the current window; the probe cannot independently prove that the first nonempty AX selection is the visible highlight. Verify this manually, especially on clear-selection and tab-switch tests.

### Search limits

| Limit | Value / behavior |
| --- | --- |
| Settling delay / fallback counter poll | 75ms / 10ms; the event tap is primary |
| Per-AX message timeout | 200ms, unchanged |
| Total AX query budget | 800ms; does not include settling or queue wait |
| Parent walk | Hit element at depth 0, at most 8 parent edges |
| Window search | Root window at depth 0, maximum depth 7 |
| Distinct inspected nodes | Maximum 64 across focused, hit, parent and window paths combined |
| Window queue | Maximum 64 distinct scheduled nodes, duplicates/cycles skipped |
| Child reads | At most 8 per call; first 64 entries per relationship at most |
| Selected-text console preview | Approximately 512 UTF-16 units, unchanged |
| Drag diagnostics | Maximum excursion from mouse-down in macOS global points, no Retina scaling; the retained 4-point experiment does not grant PASS 3 eligibility |

Limits deliberately favor safe failure over exhaustive compatibility. `query_budget_exceeded`, `node_limit_reached`, or truncation means **inconclusive within this budget**, not that Chrome cannot expose selection. If text was read before optional geometry exhausted the budget, retain that text result and mark unattempted geometry separately.

## Privacy and Accessibility permission

- No automatic Accessibility or Input Monitoring permission prompt: only `AXIsProcessTrusted()` and `CGPreflightListenEventAccess()` are used for permission state.
- The probe requires Accessibility trust to read other apps. Missing trust is not an app-compatibility failure.
- The public listen-only event tap may require Input Monitoring approval for the responsible executable. If it cannot be created, startup reports `mouse_gesture_event_tap=unavailable`; fallback counter samples remain diagnostic-only because they cannot prove click count or drag provenance.
- To test with permission, manually open **System Settings → Privacy & Security → Accessibility** and verify the identity macOS associates with the running executable. Development launches may be associated with the helper or its responsible launcher. Do not assume authorizing Electron automatically authorizes this standalone probe; do not grant unrelated/broad permissions merely to silence a failure. If the correct identity is unclear, stop and investigate.
- After granting permission, try another selection. If the trust state remains false, stop and restart the probe. Development rebuilds may also require rechecking authorization.
- No Screen Recording, Full Disk Access, Automation, or automatic Input Monitoring request is made.
- Secure fields are skipped based on the app's AX role/subrole. This cannot protect against an application that misrepresents a custom password control. **Do not test with passwords, tokens, private messages, or confidential documents.**
- Only selected text is read. The console preview is capped at roughly 512 UTF-16 units, extending to the end of a composed character if necessary. `length_utf16` and `truncated` describe the original selection. Nonempty whitespace is not English-word validation; the probe intentionally tests multiword/multiline text too.
- JSON escapes selected text, including newlines and control characters. The probe writes no data files. The terminal may retain scrollback or session logs: do not use output redirection/`tee`, and share only sanitized diagnostics. Use a public, synthetic fixture.
- Ctrl+C / SIGTERM ends the standalone process. No child helper or background service is launched.

## Run

Prerequisites: macOS 14 or later and Xcode Command Line Tools (`xcrun clang`). Backend and Electron do not need to be running.

```bash
cd "/Users/luxinyu01/Documents/Codex/ai-english-companion"
npm run spike:selection
```

Custom experimental delay:

```bash
npm run spike:selection -- --delay-ms 100
```

Compile and show help without starting observation or checking permission:

```bash
npm run spike:selection -- --help
```

After compilation, validate maximum-excursion tracking without starting observation:

```bash
dist-native/selection-probe --self-test-gesture-distance
```

The optional mode also has a safe help invocation: `npm run spike:selection -- --target-container --help`. The existing npm script passes arguments through; `package.json` does not need changes for this experiment.

Exact compile command used by the package script:

```bash
mkdir -p dist-native
xcrun clang -fobjc-arc -Wall -Wextra -mmacosx-version-min=14.0 native/SelectionProbe.m -framework AppKit -framework ApplicationServices -o dist-native/selection-probe
```

The script then runs `dist-native/selection-probe`. `dist-native/` is already ignored by Git. Existing `start`, `build`, and production native-helper scripts are unchanged.

## Expected diagnostics

Startup reports the probe PID, event-tap availability, listen-access preflight, fallback poll interval, settling delay, AX timeout, and `trusted` or `permission_required`. Each sample is a readable JSON record prefixed with `[selection-probe] sample`.

| Field | Interpretation |
| --- | --- |
| `sampleId` | Increasing ID for each observed counter change; results may finish out of order. |
| `app.name`, `app.pid`, `app.bundle_id` | App metadata captured at the approximate mouse-up time. Missing bundle ID is `null`. |
| `mouse.available`, `mouse.position`, `mouse.approximate` | Fallback position captured before the settling delay, not the mouse position at query completion. |
| `gesture.button`, `gesture.generation` | Left-button provenance and a monotonically increasing one-shot gesture identity. |
| `gesture.clickCount`, `gesture.didDrag`, `gesture.maxDragDistance`, `gesture.complete` | Public CGEvent diagnostics. `didDrag` records any dragged event and distance records maximum excursion; PASS 3 production qualifies only a fresh completed left-button gesture with click count 2+. |
| `gesture.mouseDownPosition` | Captured down point for diagnostics only; it is not selection identity or positioning input. |
| `accessibility` | `trusted` or `permission_required`; no prompt is triggered. |
| `selected_text` | Independent `status`, `value`, AX error, and on success length/truncation/nonempty metadata. An empty string can be a successful API read with no selection. |
| `range` | Independent status and `{location, length}` relative to the chosen candidate's text. Not a byte offset or screen coordinate. |
| `bounds` | Independent status and `{x, y, width, height}` in AX global top-left screen points. Numeric/positive bounds still require visual/manual accuracy checking. |
| `focused_element`, `focused_pid`, `role`, `subrole`, `timeout_setup` | Intermediate diagnostics, present only if that stage was reached. |
| `candidate_source` | `focused_element`, `hit_test`, `parent_walk`, or `bounded_window_search`. On success, the candidate that supplied text; otherwise the last candidate whose selection was actually queried, or `null`. |
| `candidate_role`, `candidate_depth` | Chosen/last-probed candidate role and depth relative to its source path. |
| `hit_test`, `hit_test_role`, `hit_test_subrole`, `hit_test_pid` | Coordinate-hit outcome and safe metadata. `mouse_unavailable` skips hit testing; `not_queried` may mean focus already succeeded or a safety/budget stop. |
| `parent_roles` | Bounded list of parent depth, role/subrole and associated AX errors; no parent text/title. |
| `nodes_visited` | Distinct inspected AX elements across the whole sample; maximum 64. |
| `candidate_attempts` | Per-candidate source/role/depth, security diagnostic and separate text/range/bounds status/error metadata; no selection values. |
| `traversal` | Parent lookup and paginated window-child count/batch diagnostics with AX errors; never child objects or document contents. |
| `usable_selection` | Nonempty text read from one candidate, cleared on discard. **Not an independent guarantee of correspondence to the user's highlight.** |
| `query_elapsed_ms`, `elapsed_ms` | Query duration vs total duration since captured mouse-up (the latter includes settling/queue delay). |
| `query_stop_reason` | Deadline, node limit, stale/app change or safety stop; `null` when discovery completed without such a stop. |
| `parent_walk_stop`, `window_depth_limit_reached`, `window_queue_limit_reached`, `child_list_truncated`, `window_repeated_nodes_skipped`, `nested_window_skipped` | Optional bounded-search diagnostics; limits/cycles are not AX errors. |
| `ax_error`, `ax_error_name` | Actual AX result for each attempted operation; `null` means no AX call was made for that field. Error 0 with `invalid_type` indicates a value-type validation failure, not an AX transport failure. |
| `stale`, `discarded`, `discard_reason` | Distinguish superseded queries, replaced pending samples, and frontmost-app changes. Discarded values are `null`; `read_status` preserves whether a read had completed. |
| `diagnostic` | For example `permission_required`, `candidate_pid_mismatch`, `secure_field_skipped`, `no_usable_selection`, or `nonempty_selection_read_verify_manually`. `focused_element` failure is no longer terminal by itself. This label alone is not an overall success verdict. |

Common AX errors: `attribute_unsupported` (-25205), `parameterized_attribute_unsupported` (-25213), `no_value` (-25212), `cannot_complete` (-25204), `api_disabled` (-25211). A timeout/transport failure is not proof of missing permission. `bounds=skipped_range_unavailable` is not a successful bounds read; `skipped_no_selection` means a zero-length range.

For example, `focused_element=no_value` + `candidate_source=parent_walk` + `selected_text.status=success` means the new fallback read text despite missing focus. Check `selected_text.value` against the actual highlight, `stale=false` and `discarded=false` before recording a pass. A `not_queried` field has no fabricated AX error code. If all candidates fail, the top-level selection fields describe only the last probed candidate; inspect `candidate_attempts` for earlier capability/error results.

AX coordinates and the sampled Core Graphics cursor use top-left global screen conventions. Do not apply Retina multiplication blindly. Negative coordinates can be valid on external displays. This probe does not convert to Electron coordinates, place an icon, clip bounds to screen work areas, or assert that an app's returned bounds are accurate.

Fallback positioning is only a future proposal: valid selected text + unavailable/unreliable bounds → captured mouse position. Missing selected text must never be treated as a valid selection solely because the mouse moved or clicked.

## Exact manual test matrix

The broad matrix below records reported overall outcomes, not unreported per-action results. The latest user-reported passes are listed above; the new targeted Figma mode remains pending.

Use synthetic text, for example:

```text
component dependency repository
This component is reusable.
Select across these two lines.
```

For editable surfaces, type this fixture manually. For webpage tests, use visible non-sensitive article/help text and write down the words selected; do not assume an input-field result proves webpage support.

Run **all six actions A–F for every available surface below**, starting with TextEdit:

| ID | App / surface | Text works? | Range works? | Bounds work / accurate? | Mouse fallback available? | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TextEdit, plain text | Yes | Yes | Yes, reported | — | PASS, user report |
| 2 | Chrome, webpage text (not an input) | Yes | — | — | — | PASS, user report |
| 3 | Chrome, input field; textarea for multiline | — | — | — | — | Not tested |
| 4 | Safari, webpage text | — | — | — | — | Not tested |
| 5 | Cursor, code editor | Yes | — | — | — | PASS, user report |
| 6 | VS Code, code editor, if installed | — | — | — | — | Not tested |
| 7 | Figma, text editing mode (not layer selection) | Not read in reported sample | — | — | — | Inconclusive: depth limit; targeted mode pending |
| 8 | Notion, text block, if available | Yes | — | — | — | PASS, user report |

| Action | Exact operation | What to verify |
| --- | --- | --- |
| A | Double-click one word. | Final non-stale sample matches the highlighted word. Earlier click samples may be discarded. |
| B | Drag-select one word, then release the left button. | Text matches; range is nonzero if supported; bounds refer to the word. |
| C | Drag-select two or more words. | Full selection is read, not just one word; record text/range/bounds separately. |
| D | Drag-select across two lines. | No crash; complete selected text; bounds may enclose both lines. For a single-line input, mark N/A and repeat using a textarea, labeled separately. |
| E | Clear the selection by clicking in the text, then click a toolbar/blank area. | Record empty selection vs unsupported attributes vs retained old selection. Some controls retain selection after a toolbar click; that is an important finding, not automatic success. |
| F | Clear and select the same word five times. | New IDs each time; no text-based duplicate suppression; each accepted sample belongs to the correct app. |

For every row/action, record this template **manually**; the probe does not save it:

| App/version + surface | Action | sampleId | AX trust | Text exact? | Range + error | Bounds + error + plausible position? | Mouse available? | Stale/discarded? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | |

Additional safety/lifecycle checks:

1. Without permission, trigger a selection: `permission_required`, no text/range/bounds reads, no permission dialog; observation continues.
2. Rapidly select different words: old results must be marked discarded with their values removed. A query can be superseded while still waiting on AX.
3. Switch apps immediately after selecting: reject results if the frontmost app changed, never relabel the old result as belonging to the new app.
4. Move the mouse during the settling delay: the logged fallback remains the captured position.
5. Test external monitors/scaling/negative coordinates if available; record bounds plausibility separately from API success.
6. Press Ctrl+C while idle and during a slow query: process exits and no probe remains active.
7. Normal `npm start` without `spike:selection` must not launch this probe. Existing translation behavior must remain unchanged.

Record macOS version, app version, delay, whether the surface is desktop/web, and any accessibility mode already enabled. Do not silently enable screen-reader modes, `AXManualAccessibility`, or browser flags to make a result pass.

## Chrome webpage public-AX experiment: manual acceptance

Chrome normal webpage body has since been reported PASS by the user. The checklist below remains a regression procedure; its individual rows have no separately supplied results and are not evidence for the new Figma experiment.

Start with a normal Chrome window and an ordinary public article/documentation page containing selectable body text. Do not use the address bar, an input, a PDF/canvas, or private/account content for the first test. Do not change Chrome flags, enable VoiceOver, or inject scripts.

**First test:** run `npm run spike:selection`, confirm `accessibility=trusted`, then double-click one visible plain-text English word in the page body. Leave the selection highlighted and wait for the sample to finish. Verify the latest non-discarded record contains exactly that word. Record which candidate source/role supplied it. Independently record range and bounds support; text with unavailable bounds is still a useful partial result, with the captured mouse position retained as the future positioning fallback. No icon is created.

| ID | Chrome webpage action | Required observation | Text exact? | Range? | Bounds / accurate? | Mouse available? | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Double-click a plain text word | Exact highlighted word; log candidate source and role | — | — | — | — | Pending |
| C2 | Drag-select one word | Exact word after release, not the previous selection | — | — | — | — | Pending |
| C3 | Select several words | Complete highlighted phrase | — | — | — | — | Pending |
| C4 | Select across bold/link/plain text | Complete selection across nodes, not just the hit node's fragment | — | — | — | — | Pending |
| C5 | Select multiple lines | Complete multiline text; record whether bounds enclose it plausibly | — | — | — | — | Pending |
| C6 | Clear selection by clicking elsewhere in body | Empty/unavailable selection; a retained old selection is a failed correspondence check | — | — | — | — | Pending |
| C7 | Switch tab and repeat C1–C3 with different words | Only the active tab's selection, never the previous tab's retained text | — | — | — | — | Pending |

For each test also record `sampleId`, `candidate_source`, `candidate_role`, `candidate_depth`, `nodes_visited`, `query_elapsed_ms`, `query_stop_reason`, `stale` and `discarded`. A supported text read, supported numeric range and supported screen bounds are separate results. If hit/parent paths find no usable text, inspect bounded-window diagnostics; if limits are reached, mark the experiment inconclusive rather than unsupported.

Recheck TextEdit and the Chrome address bar as regression baselines. Keep the default mode unchanged while testing targeted mode separately.

## Optional targeted container mode: Figma text-editing experiment

### Purpose and isolation

`--target-container` is a probe-only opt-in flag. There is no Figma bundle-ID detection, layer-name matching, UI-label matching, fixed app-specific path, or product dependency. Use it manually while testing Figma; the ordinary command and production application remain unchanged.

The original focused element, hit-test and parent-walk still run first and return immediately on successful nonempty selected text. Only if they find no usable text does targeted mode replace the normal broad window search. It does not run a second fresh query or reset the 800ms timer.

Why this exists: `window_depth_limit_reached=true` is set for any safe unsuccessfully probed node at window depth 7, even before checking whether it has children. It does not prove that the desired selection is deeper or unsupported. A window-root breadth-first search can also spend its budget in unrelated UI branches. This experiment spends the remaining budget inside **one** hit-associated container instead.

### Exactly one target container

1. Retain the already-inspected hit ancestry for this sample only, with role and distance from the hit element.
2. Read the captured app's current `AXFocusedWindow`. Use `AXMainWindow` only when the former is absent/unsupported; transport errors and malformed values fail closed. Verify window type, role, PID and security metadata.
3. Prefer the **nearest `AXWebArea` in the hit ancestry**, otherwise its nearest safe local `AXGroup`, `AXScrollArea`, `AXLayoutArea` or `AXTextArea`. Nested WebAreas are resolved nearest-first along the single ancestry chain, not by choosing an arbitrary tree match. Window/application roots are never eligible targets.
4. Require the container's public `AXWindow` relationship to match the current window. If this optional attribute is absent/unsupported, an already-inspected parent chain ending at that exact window is acceptable proof. Conflicting window evidence, no hit ancestry, no safe container, or no verifiable window produces `target_container_unavailable`. No larger scan follows.
5. All sampled nodes must belong to the captured PID. Do not use titles, layer names, document text, or full `AXValue` to find a target. No selection is cached across samples.

The container is **related to the mouse/focus context**, not guaranteed to be the text editor. `AXWebArea` is an observed role value, not a private attribute query. If Figma's mirrored editing element is outside this verified container or deeper than the local limit, the experiment can still fail safely.

### Local traversal and eligibility

- Follow only public `AXContents` / `AXChildren` relationships inside that one root, with a maximum **3 extra levels** (target root = depth 0). This can be deeper relative to the window, without changing the default window depth of 7.
- Among discovered candidates, process `AXFocused=true` first, then text roles, then safe unknown roles advertising standard selection attributes, then generic containers. This is bounded best-first ordering, not a full-tree scan to find every focused element. Geometric overlap with the mouse is not required: a legitimate accessibility editor may be nonvisual.
- For at most **6 safe unknown-role candidates**, use `AXUIElementCopyAttributeNames()`. Retain/log only whether `AXSelectedText` and/or `AXSelectedTextRange` are advertised. Unknown roles must advertise at least one before any selection read, even if focused. Reject malformed/oversized name lists (over 512 entries). Known roles keep the existing direct standard-attribute checks.
- Attribute enumeration does **not** read values of private names that might appear in the returned list. There are no text-marker calls, private-attribute reads, `AXTitle` reads, full `AXValue` reads, tree dumps, simulated keys, clipboard changes, OCR, network calls or accessibility-setting changes.
- For an eligible node, text/range/bounds are still read independently using the existing standard selection reader. Missing geometry does not turn a text read into a failure. All three values must belong to the same candidate.
- Skip secure/unverifiable/foreign-PID branches and nested window/application roots. A descendant explicitly pointing to a different window is skipped. An absent optional descendant `AXWindow` may rely on its verified container path. Recheck the current window before accepting a targeted text result; discard it if that check fails, changes window, or cannot complete within budget.

### Hard limits (shared, not additive time budgets)

| Limit | Targeted-mode value |
| --- | --- |
| Total query budget | 800ms from the original query start, including all earlier paths |
| Per-AX messaging timeout | 200ms; an already-started call may overrun the overall deadline |
| Total distinct inspected nodes | 64, including earlier focused/hit/parent work |
| Targeted new inspected nodes | 32 maximum; includes new window-verification metadata if needed |
| Target-relative depth | Root 0 through descendants at depth 3 only |
| Child batch size | At most 8 |
| Per relationship scan | At most first 32 entries; truncation is reported |
| Local scheduled identities | At most 64, with cycle/duplicate detection |
| Unknown-role attribute-name checks | At most 6 per targeted query |

Reaching the node cap stops discovery of **new** nodes but still permits already-prepared candidates to be queried while time remains. Reaching the deadline or detecting staleness/app change stops further AX calls. The query does not restart at another target if the first root fails. No strict real-time guarantee is possible against an OS/library failure; the observation queue stays independent.

### Targeted diagnostics

| Field | Interpretation |
| --- | --- |
| `probe_mode` | `target_container`; startup also explicitly reports this mode |
| `target_container_source` | `hit_test` or `parent_walk` |
| `target_container_role` | Role of the selected, verified container |
| `target_container_depth` | Number of parent edges from the original hit to the container; **not** window depth |
| `target_container_check`, `target_window_relation` | How current-window association was verified, or why it was rejected |
| `targeted_nodes_visited` | Newly inspected nodes since entering targeted mode, including any new verification node |
| `candidate_source` | `targeted_container_search` for a local candidate; earlier successful paths keep their existing source |
| `candidate_role`, `candidate_depth` | Local candidate role and depth relative to target root |
| `candidate_path` | Target role plus public relationship/index/role steps, e.g. `AXWebArea → AXChildren[0]:AXGroup → AXChildren[1]:AXTextArea`; no titles or text |
| `candidate_attributes_supported` | Enumeration status and filtered public names for unknown roles; `not_queried` for known roles is normal. It is not a bounds-capability report. |
| `candidate_attempts` | Per-attempt path, focus metadata, filtered attributes and independent selection API outcomes, without selection values |
| `target_attribute_checks` | Number of unknown-role attribute enumerations used |
| `selected_text`, `range`, `bounds` | Same independent results as normal mode; only top-level selected text contains the capped actual selection |
| `targeted_stop_reason` | `not_run`, `selection_found_verify_manually`, `target_container_unavailable`, `no_usable_selection_in_target`, depth/node/time limit, stale/app change, or `target_window_changed_or_unverifiable` |
| `query_elapsed_ms`, `elapsed_ms` | AX-query time and total time since mouse-up, unchanged |

Optional flags describe truncated child lists, depth/node/queue limits, skipped repeated nodes and rejected window branches. `targeted_depth_limit_reached` only means a depth-3 candidate was not expanded; it does not prove children exist. If an earlier focused/hit path succeeds, target fields remain `not_run`/`null` and no targeted search takes place.

### Exact manual Figma QA

Run only this standalone command; Backend and Electron need not run:

```bash
cd "/Users/luxinyu01/Documents/Codex/ai-english-companion"
npm run spike:selection -- --target-container
```

Optional settling delay (same query budget):

```bash
npm run spike:selection -- --target-container --delay-ms 100
```

Confirm startup says `mode=target_container` and `accessibility=trusted`. Do not change Figma accessibility settings or enable VoiceOver. Use a non-sensitive Figma text object containing `Popover Skeleton Example`; give the **layer a different name**, such as `Selection test layer`, so accidental layer-name output is obvious. Enter actual text editing, not merely canvas layer selection.

| Test | Action | Acceptance |
| --- | --- | --- |
| A | Mouse-select only `Popover` | Latest non-stale/non-discarded `selected_text.value` is exactly `Popover`; `usable_selection=true`; not layer name or whole block |
| B | In the same text editing session, mouse-select only `Skeleton` | Exactly `Skeleton`, a new sample, `usable_selection=true`; no old `Popover` result |
| C | Click between characters to collapse the selection | Latest sample has `usable_selection=false`; no previous text reused. Empty/unavailable selection is acceptable. |

Repeat A–C several times and record range/bounds separately. A real text match with missing bounds is partial success with the original mouse position available; bounds-only or layer-text output is not selected-text success. Inspect target source/role/depth, candidate path/attribute support, node count, stop reason and elapsed times. `usable_selection` indicates nonempty AX text, not independently verified correspondence to the user's highlight; compare it manually.

Stop with Ctrl+C. To return to the existing default probe, run `npm run spike:selection` without the flag. Do not run production Electron for this experiment.

**Failure in this mode still does not automatically mean Figma is unsupported.** It can mean no verifiable local root, unsupported attributes on the candidates reached, a different editing representation, incomplete accessibility exposure, or insufficient depth/node/time budget. Do not increase limits or enable private APIs automatically.

## Known limitations / decision gate

- The listen-only event tap is the authoritative mouse-gesture stream. Counter sampling is retained only as a diagnostic fallback and cannot enable the Selection Action because click/drag provenance is unavailable.
- No keyboard-only selection trigger, unrestricted tree traversal, text-marker extension APIs, automatic recovery, clipboard fallback reads, or OCR fallback.
- WebArea/canvas/custom editors may not expose standard selection attributes, even after bounded discovery. An owning-PID mismatch is rejected rather than guessed.
- The first reasonable candidate with nonempty text wins. Optional missing range/bounds does not cause a second search or borrowing geometry from another element. Partial/retained selections require manual verification, not frontend guesses.
- Shallow/wide trees may consume the bounded breadth-first queue before reaching the relevant WebArea. This deliberately bounded experiment can miss supported elements.
- Unreported custom secure fields cannot be reliably identified from AX metadata alone. Use synthetic data only.
- AX per-call timeout, total query budget and serial scheduling bound routine messaging delays and prevent backlog growth, but not every OS/library failure can be given a strict wall-clock bound. The observation queue remains independent.
- A nonempty range or text can be stale inside the target app even when all AX calls succeed. Validate against the actual highlight.
- A single bounding rectangle is not a set of per-line rectangles; geometry validity is not positioning accuracy.
- User-reported normal-mode passes do not establish targeted-mode Figma compatibility. Preserve the clipboard-triggered product regardless of this spike's outcome.

## Initial focused-only implementation verification (2026-09-03)

- `npm run spike:selection -- --help`: compiled successfully with `-Wall -Wextra`, no warnings; help exited without starting observation or checking permission.
- Clang static analysis: passed with no diagnostics.
- CLI invalid-delay check: rejected invalid input before observation starts.
- Temporary isolated checks, compiled from stdin into ignored `dist-native/selection-probe-checks`: passed AXValue valid/wrong-type handling, no AX attribute reads when trust is mocked false, stale-value removal including a mouse-up between poll ticks, and main-run-loop shutdown. Mouse counters and trust were mocked; no live selection was read.
- Package/scope check: only `spike:selection` was added; all existing package fields/scripts remained unchanged. Source changes are limited to this document, `native/SelectionProbe.m`, and `package.json`.
- These checks did not perform real app selection reading. Subsequent user-reported baseline results are recorded above; the complete matrix remains incomplete.

## Public-AX fallback verification (2026-09-03)

- `npm run spike:selection -- --help`: passed, no compiler warnings; exits without observation or permission checks.
- Clang static analysis: passed with no diagnostics after adding an explicit nil/type guard for candidate role validation.
- **18 isolated checks passed.** The temporary harness outside the repository replaces AX messaging, trust, mouse counters, frontmost application and the clock. Covers focused-path preservation, hit/parent/window fallback, independent text/range/bounds, original negative mouse coordinates, secure fields, foreign PID, cycles, depth/node/batch limits, nested-window exclusion, malformed AX values, total budget, app changes and stale-output redaction. No live selection or real app tree is queried.
- Invalid CLI values stop before observation; source checks exclude private marker queries and mutation APIs. Whitespace checks include the two currently untracked probe files, which ordinary `git diff --check` alone does not inspect.
- Current changes are limited to `native/SelectionProbe.m` and this document. The existing `package.json` change belongs to the earlier standalone-probe setup and is not changed in this pass.
- Compilation and isolated checks are not manual compatibility acceptance. No production Electron/Backend process is started for this verification.

## Targeted-mode implementation verification (2026-09-03)

- `npm run spike:selection -- --target-container --help`: compiled without warnings and exited without starting observation or checking permission.
- Clang static analysis: passed with no diagnostics.
- **40 isolated checks passed: 18 original default-mode regression checks + 22 targeted-mode checks.** External AX messaging, current app/window, event counters and clock were mocked. The checks cover verified single-root selection, nearest WebArea/generic container selection, window rejection, prioritization, standard-attribute eligibility, secure fields, cycles, 3-level/32-new-node/64-total-node limits, shared deadline, window changes, staleness and simulated `Popover → Skeleton → clear` behavior. No real Figma selection was read.
- **10 CLI checks passed:** default/targeted help and option ordering, invalid values, missing arguments, duplicate mode flag and unknown options all terminate before observation as appropriate.
- Package SHA-256 remains unchanged from before this pass. Whitespace checks include both untracked probe files; no production sources, extra repository files, private text-marker queries or Figma-specific identifiers were added.
- The test harness is temporary and outside the repository; no test source was added to the project. Real Figma A–C manual QA remains pending. No production Electron or Backend was started; no commit or push was performed.

## References

- [Apple: AXUIElement APIs](https://developer.apple.com/documentation/applicationservices/axuielement_h)
- [Apple: AXIsProcessTrusted](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted)
- [Apple: AX messaging timeout](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout)
- [Apple: public coordinate hit testing](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition)
- [Apple: public attribute-name enumeration](https://developer.apple.com/documentation/applicationservices/1459475-axuielementcopyattributenames)
- [Apple: event counters](https://developer.apple.com/documentation/coregraphics/cgeventsource/counterforeventtype(_:eventtype:))
- [Apple: event location](https://developer.apple.com/documentation/coregraphics/cgevent/location)
