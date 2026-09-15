import type { FailureInfo } from "./aiRecovery";
import type { ExplanationResult } from "./explanation/contracts";

export type { ExplanationResult } from "./explanation/contracts";

export const POPOVER_IPC_CHANNELS = {
  ready: "translator-popover:ready",
  state: "translator-popover:state",
  contentHeight: "translator-popover:content-height",
  retry: "translator-popover:retry",
} as const;

export type PopoverIpcChannels = typeof POPOVER_IPC_CHANNELS;

interface PopoverStateBase {
  requestId: number;
  currentApplication: string;
}

export type PopoverStatePayload =
  | (PopoverStateBase & {
      status: "loading";
      word: string;
    })
  | (PopoverStateBase & {
      status: "result";
      result: ExplanationResult;
    })
  | (PopoverStateBase & {
      status: "error" | "offline";
      word: string;
      failure: FailureInfo;
    });

export interface PopoverContentHeightPayload {
  requestId: number;
  status: PopoverStatePayload["status"];
  height: number;
}

export interface TranslatorPopoverBridge {
  ready: () => void;
  onState: (listener: (payload: PopoverStatePayload) => void) => () => void;
  reportContentHeight: (payload: PopoverContentHeightPayload) => void;
  retry: (failedRequestId: number) => void;
}
