const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const test: typeof import("node:test") = require("node:test");
const {
  WebSpeechService,
  selectPreferredLocalEnglishVoice,
} = require("./webSpeechService.ts") as typeof import("./webSpeechService");

function voice(
  lang: string,
  options: { localService?: boolean; default?: boolean; name?: string } = {},
) {
  return {
    default: options.default ?? false,
    lang,
    localService: options.localService ?? true,
    name: options.name ?? lang,
    voiceURI: options.name ?? lang,
  } as SpeechSynthesisVoice;
}

class FakeUtterance {
  readonly text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class FakeSpeechSynthesis {
  voices: SpeechSynthesisVoice[];
  utterances: FakeUtterance[] = [];
  events: string[] = [];
  cancelError = false;
  private readonly voiceListeners = new Set<EventListener>();

  constructor(voices: SpeechSynthesisVoice[] = []) {
    this.voices = voices;
  }

  getVoices() {
    return this.voices;
  }

  cancel() {
    this.events.push("cancel");
    if (this.cancelError) throw new Error("fake cancel failure");
  }

  speak(utterance: SpeechSynthesisUtterance) {
    this.events.push("speak");
    this.utterances.push(utterance as unknown as FakeUtterance);
  }

  addEventListener(type: string, listener: EventListener) {
    if (type === "voiceschanged") this.voiceListeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    if (type === "voiceschanged") this.voiceListeners.delete(listener);
  }

  emitVoicesChanged() {
    for (const listener of this.voiceListeners) listener(new Event("voiceschanged"));
  }
}

function createHarness(voices: SpeechSynthesisVoice[] = [voice("en-US")]) {
  const synthesis = new FakeSpeechSynthesis(voices);
  const service = new WebSpeechService({
    synthesis: synthesis as unknown as SpeechSynthesis,
    createUtterance: (word) =>
      new FakeUtterance(word) as unknown as SpeechSynthesisUtterance,
  });

  return { service, synthesis };
}

test("unavailable speechSynthesis makes pronunciation unavailable", () => {
  const service = new WebSpeechService({
    synthesis: null,
    createUtterance: (word) => new FakeUtterance(word) as unknown as SpeechSynthesisUtterance,
  });
  assert.equal(service.isAvailable(), false);
});

test("unavailable SpeechSynthesisUtterance makes pronunciation unavailable", () => {
  const synthesis = new FakeSpeechSynthesis([voice("en-US")]);
  const service = new WebSpeechService({
    synthesis: synthesis as unknown as SpeechSynthesis,
    createUtterance: null,
  });
  assert.equal(service.isAvailable(), false);
});

test("local default en-US voice is selected first", () => {
  const expected = voice("en-US", { default: true, name: "preferred" });
  const selected = selectPreferredLocalEnglishVoice([
    voice("en-US", { name: "other" }),
    expected,
  ]);
  assert.equal(selected, expected);
});

test("local non-default en-US is selected without a default en-US voice", () => {
  const expected = voice("en_US", { name: "american" });
  assert.equal(
    selectPreferredLocalEnglishVoice([voice("en-GB", { default: true }), expected]),
    expected,
  );
});

test("local English voice is the fallback when en-US is absent", () => {
  const expected = voice("en-GB", { default: true });
  assert.equal(selectPreferredLocalEnglishVoice([voice("fr-FR"), expected]), expected);
});

test("generic local en voice is eligible as an English fallback", () => {
  const expected = voice("en");
  assert.equal(selectPreferredLocalEnglishVoice([expected]), expected);
});

test("remote en-US voice is never selected", () => {
  const expected = voice("en-GB");
  assert.equal(
    selectPreferredLocalEnglishVoice([
      voice("en-US", { localService: false }),
      expected,
    ]),
    expected,
  );
});

test("only remote English voices make pronunciation unavailable", () => {
  assert.equal(
    selectPreferredLocalEnglishVoice([
      voice("en-US", { localService: false }),
      voice("en-GB", { localService: false }),
    ]),
    null,
  );
});

test("no English voice makes pronunciation unavailable", () => {
  assert.equal(selectPreferredLocalEnglishVoice([voice("zh-CN")]), null);
});

test("speak passes the word itself to the utterance factory", () => {
  const { service, synthesis } = createHarness();
  assert.equal(service.speak("component"), true);
  assert.equal(synthesis.utterances[0]?.text, "component");
});

test("speak cancels before starting a new utterance", () => {
  const { service, synthesis } = createHarness();
  service.speak("component");
  assert.deepEqual(synthesis.events, ["cancel", "speak"]);
});

test("repeated speak cancels each previous request instead of queueing", () => {
  const { service, synthesis } = createHarness();
  service.speak("component");
  service.speak("dependency");
  assert.deepEqual(synthesis.events, ["cancel", "speak", "cancel", "speak"]);
  assert.deepEqual(synthesis.utterances.map((utterance) => utterance.text), [
    "component",
    "dependency",
  ]);
});

test("utterance language is en-US", () => {
  const { service, synthesis } = createHarness();
  service.speak("component");
  assert.equal(synthesis.utterances[0]?.lang, "en-US");
});

test("selected local voice is assigned to the utterance", () => {
  const selectedVoice = voice("en-US", { name: "selected" });
  const { service, synthesis } = createHarness([selectedVoice]);
  service.speak("component");
  assert.equal(synthesis.utterances[0]?.voice, selectedVoice);
});

test("utterance onstart propagates for the active session", () => {
  const { service, synthesis } = createHarness();
  let starts = 0;
  service.speak("component", { onStart: () => starts += 1 });
  synthesis.utterances[0]?.onstart?.({} as SpeechSynthesisEvent);
  assert.equal(starts, 1);
});

test("utterance onend propagates for the active session", () => {
  const { service, synthesis } = createHarness();
  let ends = 0;
  service.speak("component", { onEnd: () => ends += 1 });
  synthesis.utterances[0]?.onend?.({} as SpeechSynthesisEvent);
  assert.equal(ends, 1);
});

test("utterance onerror propagates for the active session", () => {
  const { service, synthesis } = createHarness();
  let errors = 0;
  service.speak("component", { onError: () => errors += 1 });
  synthesis.utterances[0]?.onerror?.({} as SpeechSynthesisErrorEvent);
  assert.equal(errors, 1);
});

test("stale callbacks from a cancelled utterance cannot affect the new session", () => {
  const { service, synthesis } = createHarness();
  let oldEnds = 0;
  let oldErrors = 0;
  let newEnds = 0;
  service.speak("component", {
    onEnd: () => oldEnds += 1,
    onError: () => oldErrors += 1,
  });
  const oldUtterance = synthesis.utterances[0];
  service.speak("dependency", { onEnd: () => newEnds += 1 });
  oldUtterance?.onend?.({} as SpeechSynthesisEvent);
  oldUtterance?.onerror?.({} as SpeechSynthesisErrorEvent);
  synthesis.utterances[1]?.onend?.({} as SpeechSynthesisEvent);
  assert.deepEqual({ oldEnds, oldErrors, newEnds }, { oldEnds: 0, oldErrors: 0, newEnds: 1 });
});

test("cancel is safe while idle even if the platform throws", () => {
  const { service, synthesis } = createHarness();
  synthesis.cancelError = true;
  assert.doesNotThrow(() => service.cancel());
});

test("voiceschanged reports updated local voice availability", () => {
  const { service, synthesis } = createHarness([]);
  const availability: boolean[] = [];
  const unsubscribe = service.subscribeAvailability((available) => {
    availability.push(available);
  });
  synthesis.voices = [voice("en-US")];
  synthesis.emitVoicesChanged();
  unsubscribe();
  synthesis.voices = [];
  synthesis.emitVoicesChanged();
  assert.deepEqual(availability, [true]);
});

test("all speech tests use fakes and never access browser audio", () => {
  const { service, synthesis } = createHarness();
  service.speak("verification");
  assert.equal(synthesis.utterances.length, 1);
});
