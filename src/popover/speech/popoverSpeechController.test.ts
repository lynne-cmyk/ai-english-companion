const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const test: typeof import("node:test") = require("node:test");
const fs: typeof import("node:fs") = require("node:fs");
const {
  PopoverSpeechController,
} = require("./popoverSpeechController.ts") as typeof import("./popoverSpeechController");
import type { SpeechCallbacks, SpeechService } from "./speechService";

class FakeSpeechService implements SpeechService {
  available = false;
  speakResult = true;
  cancelCount = 0;
  unsubscribeCount = 0;
  readonly spokenWords: string[] = [];
  readonly callbackSets: SpeechCallbacks[] = [];
  private readonly availabilityListeners = new Set<(available: boolean) => void>();

  isAvailable() {
    return this.available;
  }

  speak(word: string, callbacks: SpeechCallbacks = {}) {
    this.spokenWords.push(word);
    this.callbackSets.push(callbacks);
    return this.speakResult;
  }

  cancel() {
    this.cancelCount += 1;
  }

  subscribeAvailability(listener: (available: boolean) => void) {
    this.availabilityListeners.add(listener);
    return () => {
      this.availabilityListeners.delete(listener);
      this.unsubscribeCount += 1;
    };
  }

  setAvailable(available: boolean) {
    this.available = available;
    for (const listener of this.availabilityListeners) listener(available);
  }
}

function createHarness(available = true) {
  const service = new FakeSpeechService();
  service.available = available;
  const controller = new PopoverSpeechController(service);
  const states: Array<{ available: boolean; active: boolean; canSpeak: boolean }> = [];
  const disconnect = controller.connect((state) => states.push(state));

  return {
    controller,
    disconnect,
    service,
    states,
    state: () => states.at(-1) ?? controller.getState(),
  };
}

test("Result with speech unavailable keeps Speaker disabled", () => {
  const { controller, state } = createHarness(false);
  controller.setResult(1, "component");
  assert.equal(state().canSpeak, false);
});

test("Result with local English speech available enables Speaker", () => {
  const { controller, state } = createHarness();
  controller.setResult(1, "component");
  assert.equal(state().canSpeak, true);
});

test("voiceschanged-style availability enables Speaker later", () => {
  const { controller, service, state } = createHarness(false);
  controller.setResult(1, "component");
  service.setAvailable(true);
  assert.deepEqual(state(), { available: true, active: false, canSpeak: true });
});

test("Speaker click sends current result.word and never phonetic", () => {
  const { controller, service } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  assert.deepEqual(service.spokenWords, ["component"]);
  assert.equal(service.spokenWords.includes("/kəmˈpoʊ.nənt/"), false);
});

test("onStart makes Speaker active and onEnd returns it to idle", () => {
  const { controller, service, state } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  service.callbackSets[0]?.onStart?.();
  assert.equal(state().active, true);
  service.callbackSets[0]?.onEnd?.();
  assert.equal(state().active, false);
});

test("onError returns Speaker to idle without changing Result", () => {
  const { controller, service, state } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  service.callbackSets[0]?.onStart?.();
  service.callbackSets[0]?.onError?.();
  assert.deepEqual(state(), { available: true, active: false, canSpeak: true });
});

test("failed speak leaves Speaker idle", () => {
  const { controller, service, state } = createHarness();
  service.speakResult = false;
  controller.setResult(1, "component");
  assert.equal(controller.speak(), false);
  assert.equal(state().active, false);
});

test("repeated click issues a second request without UI queue state", () => {
  const { controller, service } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  controller.speak();
  assert.deepEqual(service.spokenWords, ["component", "component"]);
});

test("new result cancels speech, resets active, and does not auto-play", () => {
  const { controller, service, state } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  service.callbackSets[0]?.onStart?.();
  const cancellationsBeforeChange = service.cancelCount;
  controller.setResult(2, "architecture");
  assert.equal(service.cancelCount, cancellationsBeforeChange + 1);
  assert.equal(state().active, false);
  assert.deepEqual(service.spokenWords, ["component"]);
});

test("a new request for the same result word still cancels old speech", () => {
  const { controller, service, state } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  service.callbackSets[0]?.onStart?.();
  const cancellationsBeforeChange = service.cancelCount;
  controller.setResult(2, "component");
  assert.equal(service.cancelCount, cancellationsBeforeChange + 1);
  assert.equal(state().active, false);
  assert.deepEqual(service.spokenWords, ["component"]);
});

for (const nextState of ["Loading", "Error", "Offline"]) {
  test(`Result to ${nextState} cancels speech`, () => {
    const { controller, service, state } = createHarness();
    controller.setResult(1, "component");
    controller.speak();
    service.callbackSets[0]?.onStart?.();
    const cancellationsBeforeTransition = service.cancelCount;
    controller.setResult(null, null);
    assert.equal(service.cancelCount, cancellationsBeforeTransition + 1);
    assert.deepEqual(state(), { available: true, active: false, canSpeak: false });
  });
}

test("document hidden lifecycle cancels speech and resets active", () => {
  const { controller, service, state } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  service.callbackSets[0]?.onStart?.();
  const cancellationsBeforeHide = service.cancelCount;
  controller.handleVisibility(true);
  assert.equal(service.cancelCount, cancellationsBeforeHide + 1);
  assert.equal(state().active, false);
});

test("cleanup unsubscribes availability and cancels speech", () => {
  const { disconnect, service } = createHarness();
  const cancellationsBeforeCleanup = service.cancelCount;
  disconnect();
  assert.equal(service.unsubscribeCount, 1);
  assert.equal(service.cancelCount, cancellationsBeforeCleanup + 1);
});

test("old callbacks and callbacks after cleanup cannot update state", () => {
  const { controller, disconnect, service, states } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  const oldCallbacks = service.callbackSets[0];
  controller.speak();
  oldCallbacks?.onStart?.();
  assert.equal(states.at(-1)?.active, false);
  disconnect();
  const stateCountAfterCleanup = states.length;
  service.callbackSets[1]?.onStart?.();
  service.setAvailable(false);
  assert.equal(states.length, stateCountAfterCleanup);
});

test("losing local voice availability cancels active pronunciation", () => {
  const { controller, service, state } = createHarness();
  controller.setResult(1, "component");
  controller.speak();
  service.callbackSets[0]?.onStart?.();
  service.setAvailable(false);
  assert.deepEqual(state(), { available: false, active: false, canSpeak: false });
});

test("production renderer uses speech integration instead of hardcoded disabled state", () => {
  const source = fs.readFileSync("src/popover/PopoverRenderer.tsx", "utf8");
  assert.match(source, /usePopoverSpeech/);
  assert.match(source, /speakerDisabled=\{speakerDisabled\}/);
  assert.match(source, /onSpeakerToggle=\{speak\}/);
  assert.doesNotMatch(source, /speakerActive=\{false\}/);
});

test("renderer speech integration has no Electron, preload, or IPC dependency", () => {
  const controllerSource = fs.readFileSync(
    "src/popover/speech/popoverSpeechController.ts",
    "utf8",
  );
  const hookSource = fs.readFileSync(
    "src/popover/speech/usePopoverSpeech.ts",
    "utf8",
  );
  assert.doesNotMatch(`${controllerSource}\n${hookSource}`, /electron|ipc|preload/i);
  assert.match(hookSource, /visibilitychange/);
  assert.match(hookSource, /document\.hidden/);
});

test("production integration tests use only fake speech and produce no audio", () => {
  const { controller, service } = createHarness();
  controller.setResult(1, "verification");
  controller.speak();
  assert.deepEqual(service.spokenWords, ["verification"]);
});
