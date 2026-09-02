import { contextBridge, ipcRenderer } from "electron";
import type {
  PopoverContentHeightPayload,
  PopoverIpcChannels,
  PopoverStatePayload,
  TranslatorPopoverBridge,
} from "./popoverIpc";

const channels: PopoverIpcChannels = {
  ready: "translator-popover:ready",
  state: "translator-popover:state",
  contentHeight: "translator-popover:content-height",
};

const bridge: TranslatorPopoverBridge = {
  ready() {
    ipcRenderer.send(channels.ready);
  },
  onState(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: PopoverStatePayload,
    ) => {
      listener(payload);
    };

    ipcRenderer.on(channels.state, handler);

    return () => {
      ipcRenderer.removeListener(channels.state, handler);
    };
  },
  reportContentHeight(payload: PopoverContentHeightPayload) {
    ipcRenderer.send(channels.contentHeight, payload);
  },
};

contextBridge.exposeInMainWorld("translatorPopover", bridge);
