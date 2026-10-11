import { imagePalette } from "./imagePalette.ts";
import { resizeImportance, type AiImportanceMask } from "./aiPosterization.ts";
import { maxPaletteColors } from "./paletteLimits.ts";
import type { PaletteColor } from "../project/model.ts";

/** Adds physical paints sampled only from detected faces, retaining locked paints. */
export function facePalette(pixels: Uint8ClampedArray, width: number, height: number,
  mask: AiImportanceMask | undefined, palette: readonly PaletteColor[], count: number): readonly PaletteColor[] {
  if (!Number.isInteger(count) || count < 0 || count > 8) throw Error("Invalid additional face shade count.");
  if (pixels.length !== width * height * 4) throw Error("Invalid face palette image.");
  const base = palette.filter(colour => !colour.autoFaceShade || colour.locked);
  if (!base.length && palette.length) base.push({...palette[0], autoFaceShade: false});
  const slots = palette.filter(colour => colour.autoFaceShade && !colour.locked);
  if (!mask?.faceMask || count === 0 || base.length >= maxPaletteColors) return base;
  const faces = resizeImportance({...mask, values: mask.faceMask}, width, height);
  const samples: number[] = [];
  const visible = faces.reduce((total, value, i) => total + (value && pixels[i * 4 + 3] >= 128 ? 1 : 0), 0);
  const stride = Math.max(1, Math.ceil(visible / 20000));
  let ordinal = 0;
  for (let i = 0; i < faces.length; i++) {
    if (faces[i] && pixels[i * 4 + 3] >= 128 && ordinal++ % stride === 0) samples.push(...pixels.subarray(i * 4, i * 4 + 4));
  }
  if (!samples.length) return base;
  const remaining = Math.max(0, count - base.filter(colour => colour.autoFaceShade).length);
  const colours = imagePalette(new Uint8ClampedArray(samples), Math.min(maxPaletteColors, base.length + remaining), base.map(colour => colour.hex));
  return [...base, ...colours.map((hex, index): PaletteColor => ({
    id: slots[index]?.id ?? crypto.randomUUID(), name: slots[index]?.name ?? `Face shade ${index + 1}`,
    hex, autoFaceShade: true, locked: false, skipPainting: slots[index]?.skipPainting ?? false,
    restricted: slots[index]?.restricted ?? false, hueToleranceDeg: slots[index]?.hueToleranceDeg ?? 30, minimumChroma: slots[index]?.minimumChroma ?? .04,
  }))];
}
