import assert from "node:assert/strict";
import test from "node:test";
import { hexToHsv, hsvToHex } from "../src/core/colorPicker.ts";
test("picker HSV conversion preserves RGB colours including neutrals", () => {
  for (const hex of ["#72A8D6", "#33BB36", "#FF0000", "#0000FF", "#FFFFFF", "#000000", "#808080", "#123456"]) assert.equal(hsvToHex(...hexToHsv(hex)), hex);
});
test("picker saturation and brightness corners and wrapped hue", () => {
  assert.equal(hsvToHex(208, 0, 100), "#FFFFFF");
  assert.equal(hsvToHex(208, 100, 0), "#000000");
  assert.equal(hsvToHex(120, 100, 100), "#00FF00");
  assert.equal(hsvToHex(360, 100, 100), "#FF0000");
});
