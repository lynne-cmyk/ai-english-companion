import { nativeImage, type NativeImage } from "electron";

export const MENU_BAR_ICON_LOGICAL_SIZE = 18;

// The approved single-sparkle shape, rasterized at 1x and 2x. Electron's
// NativeImage reliably decodes PNG buffers in packaged macOS applications,
// while SVG data URLs can produce an empty or non-rendering status item.
export const MENU_BAR_ICON_1X_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAW0lEQVR4nGNgGIrAAYopBgVQTDFYD8UUg/tQTBFQYGBg+A/FApQYUoBkUAFUjCBwgCpeD/XKfxz4PlRNAa7YpJpBVPMaLsMoDmwYoEr0M1AzQVIti1At09IXAAC1bSh9QFG5hAAAAABJRU5ErkJggg==";

export const MENU_BAR_ICON_2X_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAyElEQVR4nO2Y3QmDMBRGM0JGcISO4AgZJSO4gSNkFEfJCI7QEviESwltfKj3QD3wPYnmaP5uDOHmT5kUDEnBsCoYNgXDU0EwG6GHt0wjG6HsLdMoRqh4yzSqEareMtHIHImeQqkj5LpALh2h5WqJqK/QGt47QruupV9136zpXN4G8Giq7s161ikmvdmqreBs46PZ1Eb6ViXghHBdNoL7oP4EYtpbcAsjbusItM01EMsPXIGGK2EDrcgPxGMQ7qCIO0rjfjbcXMYLNxihhaAJ8tUAAAAASUVORK5CYII=";

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
