import path from "node:path";

export type NativeHelper =
  | "frontmostApp"
  | "globalMouseMonitor"
  | "selectionProbe";

export interface NativeHelperPathContext {
  isPackaged: boolean;
  resourcesPath: string;
  developmentRoot: string;
}

const NATIVE_HELPER_FILENAMES: Record<NativeHelper, string> = {
  frontmostApp: "frontmost-app",
  globalMouseMonitor: "global-mouse-monitor",
  selectionProbe: "selection-probe",
};

export function resolveNativeHelperPath(
  helper: NativeHelper,
  context: NativeHelperPathContext,
) {
  const helperRoot = context.isPackaged
    ? path.join(context.resourcesPath, "native")
    : path.join(context.developmentRoot, "dist-native");

  return path.join(helperRoot, NATIVE_HELPER_FILENAMES[helper]);
}

export function resolveNativeHelperWorkingDirectory(
  context: NativeHelperPathContext,
) {
  return context.isPackaged
    ? path.join(context.resourcesPath, "native")
    : context.developmentRoot;
}
