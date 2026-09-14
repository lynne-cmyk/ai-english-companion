import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  MENU_BAR_ICON_1X_PNG_BASE64,
  MENU_BAR_ICON_2X_PNG_BASE64,
  MENU_BAR_ICON_LOGICAL_SIZE,
} from "./menuBarIcon";

function pngDimensions(base64: string) {
  const png = Buffer.from(base64, "base64");
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

test("menu bar icon embeds valid 18px and Retina 36px PNG representations", () => {
  assert.deepEqual(pngDimensions(MENU_BAR_ICON_1X_PNG_BASE64), {
    width: MENU_BAR_ICON_LOGICAL_SIZE,
    height: MENU_BAR_ICON_LOGICAL_SIZE,
  });
  assert.deepEqual(pngDimensions(MENU_BAR_ICON_2X_PNG_BASE64), {
    width: MENU_BAR_ICON_LOGICAL_SIZE * 2,
    height: MENU_BAR_ICON_LOGICAL_SIZE * 2,
  });
});

test("menu bar icon payloads contain visible raster data", () => {
  assert.ok(Buffer.from(MENU_BAR_ICON_1X_PNG_BASE64, "base64").length > 100);
  assert.ok(Buffer.from(MENU_BAR_ICON_2X_PNG_BASE64, "base64").length > 100);
});
