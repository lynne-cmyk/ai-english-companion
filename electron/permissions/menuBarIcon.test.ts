import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
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

test("menu bar icon embeds valid 16px and Retina 32px PNG representations", () => {
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

test("embedded Menu Bar representations match generated template assets", () => {
  for (const [file, base64] of [
    ["menuBarTemplate.png", MENU_BAR_ICON_1X_PNG_BASE64],
    ["menuBarTemplate@2x.png", MENU_BAR_ICON_2X_PNG_BASE64],
  ]) {
    assert.deepEqual(
      Buffer.from(base64, "base64"),
      readFileSync(path.join(process.cwd(), "assets/brand/generated", file)),
    );
  }
});
