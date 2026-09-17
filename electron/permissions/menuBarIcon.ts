import { nativeImage, type NativeImage } from "electron";

import {
  MENU_BAR_ICON_1X_PNG_BASE64,
  MENU_BAR_ICON_2X_PNG_BASE64,
} from "./menuBarIconData";
export {
  MENU_BAR_ICON_LOGICAL_SIZE,
  MENU_BAR_ICON_1X_PNG_BASE64,
  MENU_BAR_ICON_2X_PNG_BASE64,
} from "./menuBarIconData";

export function createMenuBarIcon(): NativeImage {
  const icon = nativeImage.createFromBuffer(
    Buffer.from(MENU_BAR_ICON_1X_PNG_BASE64, "base64"),
  );
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: Buffer.from(MENU_BAR_ICON_2X_PNG_BASE64, "base64"),
  });
  icon.setTemplateImage(true);

  const size = icon.getSize();
  console.log(
    `[tray] image source=embedded-png empty=${icon.isEmpty()} size=${size.width}x${size.height} template=true`,
  );
  return icon;
}
