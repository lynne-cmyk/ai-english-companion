import type { TranslatorPopoverBridge } from "../../electron/popoverIpc";

declare global {
  interface Window {
    translatorPopover: TranslatorPopoverBridge;
  }
}

export {};
