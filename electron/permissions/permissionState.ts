import type {
  AccessibilityPermissionState,
  InputMonitoringPermissionState,
  PermissionStateSnapshot,
  ProductPermissionStatus,
} from "./contracts";

export type ProbeLifecycleState = "starting" | "ready" | "failed";
export type ListenPreflightState = "unknown" | "granted" | "not_granted";

export interface ProbePermissionEvidence {
  generation: number;
  probe: ProbeLifecycleState;
  accessibility: AccessibilityPermissionState;
  inputMonitoring: InputMonitoringPermissionState;
  listenPreflight: ListenPreflightState;
  eventTapCreated: boolean | null;
  pid: number | null;
  failureReason?: string;
}

export interface ProbeStartupStatus {
  type: "probe_status";
  version: 1;
  ready: true;
  accessibility: "trusted" | "permission_required";
  listen_preflight: "granted" | "not_granted";
  event_tap_operational: boolean;
  pid: number;
}

export interface PermissionStateServiceOptions {
  checkMainAccessibility(): boolean;
  restartProbe(): number | null | Promise<number | null>;
  startupWaitTimeoutMs?: number;
  log?: (message: string) => void;
}

const INITIAL_PROBE_EVIDENCE: ProbePermissionEvidence = {
  generation: 0,
  probe: "starting",
  accessibility: "unknown",
  inputMonitoring: "unknown",
  listenPreflight: "unknown",
  eventTapCreated: null,
  pid: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseProbeStartupStatus(
  value: unknown,
): ProbeStartupStatus | null {
  const status = asRecord(value);
  if (
    status?.type !== "probe_status" ||
    status.version !== 1 ||
    status.ready !== true ||
    (status.accessibility !== "trusted" &&
      status.accessibility !== "permission_required") ||
    (status.listen_preflight !== "granted" &&
      status.listen_preflight !== "not_granted") ||
    typeof status.event_tap_operational !== "boolean" ||
    !Number.isInteger(status.pid) ||
    (status.pid as number) <= 0
  ) {
    return null;
  }

  return status as unknown as ProbeStartupStatus;
}

export function probeEvidenceFromStartupStatus(
  generation: number,
  status: ProbeStartupStatus,
): ProbePermissionEvidence {
  // The version-1 wire name predates the permission audit. Native currently
  // sets this value from CGEventTapCreate() != NULL, so it proves creation,
  // not that the callback has delivered an event.
  const eventTapCreated = status.event_tap_operational;
  return {
    generation,
    probe: "ready",
    accessibility:
      status.accessibility === "trusted" ? "granted" : "denied",
    inputMonitoring: classifyInputMonitoringEvidence(
      status.listen_preflight,
      eventTapCreated,
    ),
    listenPreflight: status.listen_preflight,
    eventTapCreated,
    pid: status.pid,
  };
}

export function classifyInputMonitoringEvidence(
  listenPreflight: ListenPreflightState,
  eventTapCreated: boolean | null,
): InputMonitoringPermissionState {
  // A denied preflight is authoritative permission evidence. A tap object may
  // still be created in this state, but manual QA proves that creation alone
  // does not mean the Selection Trigger receives gesture events.
  if (listenPreflight === "not_granted") return "unavailable";

  if (listenPreflight === "granted" && eventTapCreated === true) {
    return "operational";
  }

  // granted + no tap is contradictory (permission exists but capability did
  // not initialize). Unknown or incomplete evidence must also fail closed.
  return "unknown";
}

export function deriveProductPermissionStatus(
  mainAccessibility: AccessibilityPermissionState,
  probeEvidence: ProbePermissionEvidence,
  checking = false,
): ProductPermissionStatus {
  if (checking || probeEvidence.probe === "starting") return "checking";
  if (probeEvidence.probe === "failed") return "helper_unavailable";

  if (
    mainAccessibility === "unknown" ||
    probeEvidence.accessibility === "unknown" ||
    probeEvidence.inputMonitoring === "unknown"
  ) {
    return "indeterminate";
  }

  if (mainAccessibility !== probeEvidence.accessibility) {
    return "indeterminate";
  }

  if (
    mainAccessibility === "denied" &&
    probeEvidence.inputMonitoring === "unavailable"
  ) {
    return "needs_both";
  }
  if (mainAccessibility === "denied") return "needs_accessibility";
  if (probeEvidence.inputMonitoring === "unavailable") {
    return "needs_input_monitoring";
  }
  return "ready";
}

export class PermissionStateService {
  private mainAccessibility: AccessibilityPermissionState = "unknown";
  private probeEvidence: ProbePermissionEvidence = {
    ...INITIAL_PROBE_EVIDENCE,
  };
  private checking = true;
  private revision = 0;
  private snapshot: PermissionStateSnapshot = {
    status: "checking",
    accessibility: "unknown",
    inputMonitoring: "unknown",
    revision: 0,
  };
  private readonly listeners = new Set<
    (snapshot: PermissionStateSnapshot) => void
  >();
  private pendingRecheck: Promise<PermissionStateSnapshot> | null = null;
  private readonly terminalWaiters = new Map<
    number,
    Set<() => void>
  >();

  constructor(private readonly options: PermissionStateServiceOptions) {}

  get current() {
    return { ...this.snapshot };
  }

  get diagnostics() {
    return {
      mainAccessibility: this.mainAccessibility,
      probe: { ...this.probeEvidence },
      checking: this.checking,
    };
  }

  subscribe(listener: (snapshot: PermissionStateSnapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize() {
    this.mainAccessibility = this.readMainAccessibility();
    this.checking = false;
    this.publishDerivedState();
    return this.current;
  }

  markHelperUnavailable(failureReason: string) {
    return this.acceptProbeEvidence({
      generation: Math.max(1, this.probeEvidence.generation + 1),
      probe: "failed",
      accessibility: "unknown",
      inputMonitoring: "unknown",
      listenPreflight: "unknown",
      eventTapCreated: null,
      pid: null,
      failureReason,
    });
  }

  acceptProbeEvidence(evidence: ProbePermissionEvidence) {
    if (
      !Number.isInteger(evidence.generation) ||
      evidence.generation <= 0 ||
      evidence.generation < this.probeEvidence.generation
    ) {
      return false;
    }

    if (evidence.generation === this.probeEvidence.generation) {
      if (this.probeEvidence.probe === "failed") return false;
      if (
        this.probeEvidence.probe === "ready" &&
        evidence.probe !== "failed"
      ) {
        return false;
      }
    }

    this.probeEvidence = { ...evidence };
    this.publishDerivedState();

    if (evidence.probe !== "starting") {
      for (const resolve of this.terminalWaiters.get(evidence.generation) ?? []) {
        resolve();
      }
      this.terminalWaiters.delete(evidence.generation);
    }
    return true;
  }

  recheck() {
    if (this.pendingRecheck !== null) return this.pendingRecheck;

    this.pendingRecheck = this.performRecheck().finally(() => {
      this.pendingRecheck = null;
    });
    return this.pendingRecheck;
  }

  private async performRecheck() {
    this.checking = true;
    this.publishDerivedState();
    this.mainAccessibility = this.readMainAccessibility();

    let generation: number | null;
    try {
      generation = await this.options.restartProbe();
    } catch {
      generation = null;
    }

    if (generation === null) {
      const failedGeneration = Math.max(
        1,
        this.probeEvidence.generation + 1,
      );
      this.acceptProbeEvidence({
        generation: failedGeneration,
        probe: "failed",
        accessibility: "unknown",
        inputMonitoring: "unknown",
        listenPreflight: "unknown",
        eventTapCreated: null,
        pid: null,
        failureReason: "restart_unavailable",
      });
    } else {
      await this.waitForTerminalProbeState(generation);
    }

    this.checking = false;
    this.publishDerivedState();
    return this.current;
  }

  private readMainAccessibility(): AccessibilityPermissionState {
    try {
      return this.options.checkMainAccessibility() ? "granted" : "denied";
    } catch {
      return "unknown";
    }
  }

  private waitForTerminalProbeState(generation: number) {
    if (
      this.probeEvidence.generation === generation &&
      this.probeEvidence.probe !== "starting"
    ) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        const waiters = this.terminalWaiters.get(generation);
        waiters?.delete(finish);
        if (waiters?.size === 0) this.terminalWaiters.delete(generation);
        this.acceptProbeEvidence({
          generation,
          probe: "failed",
          accessibility: "unknown",
          inputMonitoring: "unknown",
          listenPreflight: "unknown",
          eventTapCreated: null,
          pid: null,
          failureReason: "recheck_timeout",
        });
        finish();
      }, this.options.startupWaitTimeoutMs ?? 2_500);

      const finish = () => {
        clearTimeout(timeout);
        resolve();
      };
      const waiters = this.terminalWaiters.get(generation) ?? new Set();
      waiters.add(finish);
      this.terminalWaiters.set(generation, waiters);
    });
  }

  private publishDerivedState() {
    const status = deriveProductPermissionStatus(
      this.mainAccessibility,
      this.probeEvidence,
      this.checking,
    );
    const nextCore = {
      status,
      accessibility:
        this.mainAccessibility === this.probeEvidence.accessibility
          ? this.mainAccessibility
          : "unknown",
      inputMonitoring: this.probeEvidence.inputMonitoring,
    } as const;

    if (
      this.snapshot.status === nextCore.status &&
      this.snapshot.accessibility === nextCore.accessibility &&
      this.snapshot.inputMonitoring === nextCore.inputMonitoring
    ) {
      return;
    }

    const previousStatus = this.snapshot.status;
    this.snapshot = { ...nextCore, revision: ++this.revision };
    this.options.log?.(
      `[permission-state] state ${JSON.stringify({
        previousStatus,
        status,
        accessibility: nextCore.accessibility,
        inputMonitoring: nextCore.inputMonitoring,
        probe: this.probeEvidence.probe,
        listenPreflight: this.probeEvidence.listenPreflight,
        eventTapCreated: this.probeEvidence.eventTapCreated,
        revision: this.snapshot.revision,
      })}`,
    );
    for (const listener of this.listeners) listener(this.current);
  }
}
