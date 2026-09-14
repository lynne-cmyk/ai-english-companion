import assert from "node:assert/strict";
import test from "node:test";
import {
  PermissionStateService,
  classifyInputMonitoringEvidence,
  deriveProductPermissionStatus,
  parseProbeStartupStatus,
  probeEvidenceFromStartupStatus,
  type ProbePermissionEvidence,
} from "./permissionState";

function evidence(
  overrides: Partial<ProbePermissionEvidence> = {},
): ProbePermissionEvidence {
  return {
    generation: 1,
    probe: "ready",
    accessibility: "granted",
    inputMonitoring: "operational",
    listenPreflight: "granted",
    eventTapCreated: true,
    pid: 123,
    ...overrides,
  };
}

test("permission matrix derives all actionable product states", () => {
  assert.equal(
    deriveProductPermissionStatus("granted", evidence()),
    "ready",
  );
  assert.equal(
    deriveProductPermissionStatus(
      "denied",
      evidence({ accessibility: "denied" }),
    ),
    "needs_accessibility",
  );
  assert.equal(
    deriveProductPermissionStatus(
      "granted",
      evidence({
        inputMonitoring: "unavailable",
        listenPreflight: "not_granted",
        eventTapCreated: false,
      }),
    ),
    "needs_input_monitoring",
  );
  assert.equal(
    deriveProductPermissionStatus(
      "denied",
      evidence({
        accessibility: "denied",
        inputMonitoring: "unavailable",
        listenPreflight: "not_granted",
        eventTapCreated: false,
      }),
    ),
    "needs_both",
  );
});

test("helper failure has a distinct product state", () => {
  assert.equal(
    deriveProductPermissionStatus(
      "granted",
      evidence({
        probe: "failed",
        accessibility: "unknown",
        inputMonitoring: "unknown",
        eventTapCreated: null,
        pid: null,
      }),
    ),
    "helper_unavailable",
  );
});

test("a current helper exit moves ready state to helper_unavailable", () => {
  const service = new PermissionStateService({
    checkMainAccessibility: () => true,
    restartProbe: () => null,
  });
  service.initialize();
  service.acceptProbeEvidence(evidence());
  assert.equal(service.current.status, "ready");
  assert.equal(
    service.acceptProbeEvidence(
      evidence({
        probe: "failed",
        accessibility: "unknown",
        inputMonitoring: "unknown",
        listenPreflight: "unknown",
        eventTapCreated: null,
        pid: null,
        failureReason: "probe_process_exit",
      }),
    ),
    true,
  );
  assert.equal(service.current.status, "helper_unavailable");
});

test("main and helper Accessibility disagreement is indeterminate", () => {
  assert.equal(
    deriveProductPermissionStatus(
      "granted",
      evidence({ accessibility: "denied" }),
    ),
    "indeterminate",
  );
  assert.equal(
    deriveProductPermissionStatus(
      "denied",
      evidence({ accessibility: "granted" }),
    ),
    "indeterminate",
  );
});

test("startup and unknown evidence remain checking or indeterminate", () => {
  assert.equal(
    deriveProductPermissionStatus(
      "granted",
      evidence({
        probe: "starting",
        accessibility: "unknown",
        inputMonitoring: "unknown",
        eventTapCreated: null,
        pid: null,
      }),
    ),
    "checking",
  );
  assert.equal(
    deriveProductPermissionStatus(
      "granted",
      evidence({ inputMonitoring: "unknown" }),
    ),
    "indeterminate",
  );
});

test("input-monitoring evidence matrix fails closed", () => {
  assert.equal(
    classifyInputMonitoringEvidence("granted", true),
    "operational",
  );
  assert.equal(
    classifyInputMonitoringEvidence("granted", false),
    "unknown",
  );
  assert.equal(
    classifyInputMonitoringEvidence("not_granted", true),
    "unavailable",
  );
  assert.equal(
    classifyInputMonitoringEvidence("not_granted", false),
    "unavailable",
  );
  assert.equal(
    classifyInputMonitoringEvidence("unknown", null),
    "unknown",
  );
});

test("granted preflight and a created tap produce operational ready state", () => {
  const status = parseProbeStartupStatus({
    type: "probe_status",
    version: 1,
    ready: true,
    accessibility: "trusted",
    listen_preflight: "granted",
    event_tap_operational: true,
    pid: 455,
  });
  assert.ok(status);
  const mapped = probeEvidenceFromStartupStatus(6, status);
  assert.equal(mapped.inputMonitoring, "operational");
  assert.equal(mapped.listenPreflight, "granted");
  assert.equal(mapped.eventTapCreated, true);
  assert.equal(deriveProductPermissionStatus("granted", mapped), "ready");
});

test("denied preflight and no tap require Input Monitoring", () => {
  const status = parseProbeStartupStatus({
    type: "probe_status",
    version: 1,
    ready: true,
    accessibility: "trusted",
    listen_preflight: "not_granted",
    event_tap_operational: false,
    pid: 455,
  });
  assert.ok(status);
  const mapped = probeEvidenceFromStartupStatus(6, status);
  assert.equal(mapped.inputMonitoring, "unavailable");
  assert.equal(mapped.eventTapCreated, false);
  assert.equal(
    deriveProductPermissionStatus("granted", mapped),
    "needs_input_monitoring",
  );
});

test("denied preflight cannot become ready when a tap object was created", () => {
  const status = parseProbeStartupStatus({
    type: "probe_status",
    version: 1,
    ready: true,
    accessibility: "trusted",
    listen_preflight: "not_granted",
    event_tap_operational: true,
    pid: 456,
  });
  assert.ok(status);
  assert.deepEqual(probeEvidenceFromStartupStatus(7, status), {
    generation: 7,
    probe: "ready",
    accessibility: "granted",
    inputMonitoring: "unavailable",
    listenPreflight: "not_granted",
    eventTapCreated: true,
    pid: 456,
  });
  assert.equal(
    deriveProductPermissionStatus(
      "granted",
      probeEvidenceFromStartupStatus(7, status),
    ),
    "needs_input_monitoring",
  );
});

test("granted preflight with a failed tap stays indeterminate", () => {
  const contradictory = evidence({
    inputMonitoring: classifyInputMonitoringEvidence("granted", false),
    listenPreflight: "granted",
    eventTapCreated: false,
  });
  assert.equal(
    deriveProductPermissionStatus("granted", contradictory),
    "indeterminate",
  );
});

test("malformed or unsupported startup handshakes are rejected", () => {
  for (const value of [
    null,
    {},
    { type: "probe_status", version: 2 },
    {
      type: "probe_status",
      version: 1,
      ready: true,
      accessibility: "trusted",
      listen_preflight: "granted",
      event_tap_operational: "yes",
      pid: 123,
    },
    {
      type: "probe_status",
      version: 1,
      ready: true,
      accessibility: "trusted",
      listen_preflight: "granted",
      event_tap_operational: 1,
      pid: 123,
    },
    {
      type: "probe_status",
      version: 1,
      ready: true,
      accessibility: "trusted",
      listen_preflight: "not_granted",
      event_tap_operational: 0,
      pid: 123,
    },
    {
      type: "probe_status",
      version: 1,
      ready: true,
      accessibility: "unexpected",
      listen_preflight: "granted",
      event_tap_operational: true,
      pid: 123,
    },
  ]) {
    assert.equal(parseProbeStartupStatus(value), null);
  }
});

test("late status from an older helper generation cannot overwrite current state", () => {
  const service = new PermissionStateService({
    checkMainAccessibility: () => true,
    restartProbe: () => null,
  });
  service.initialize();
  assert.equal(service.acceptProbeEvidence(evidence({ generation: 2 })), true);
  assert.equal(service.current.status, "ready");
  assert.equal(
    service.acceptProbeEvidence(
      evidence({
        generation: 1,
        accessibility: "denied",
        inputMonitoring: "unavailable",
        eventTapCreated: false,
      }),
    ),
    false,
  );
  assert.equal(service.current.status, "ready");
  assert.equal(service.diagnostics.probe.generation, 2);
});

test("recheck coalesces concurrent requests and returns refreshed state", async () => {
  let accessibilityGranted = false;
  let restartCount = 0;
  let service: PermissionStateService;
  service = new PermissionStateService({
    checkMainAccessibility: () => accessibilityGranted,
    restartProbe: () => {
      restartCount += 1;
      queueMicrotask(() => {
        service.acceptProbeEvidence(
          evidence({
            generation: 2,
            accessibility: "granted",
          }),
        );
      });
      return 2;
    },
  });
  service.initialize();
  service.acceptProbeEvidence(
    evidence({ generation: 1, accessibility: "denied" }),
  );
  assert.equal(service.current.status, "needs_accessibility");

  accessibilityGranted = true;
  const first = service.recheck();
  const second = service.recheck();
  assert.equal(first, second);
  assert.equal((await first).status, "ready");
  assert.equal(restartCount, 1);
});

test("an unavailable restart fails closed as helper_unavailable", async () => {
  const service = new PermissionStateService({
    checkMainAccessibility: () => true,
    restartProbe: () => null,
  });
  service.initialize();
  assert.equal((await service.recheck()).status, "helper_unavailable");
});
