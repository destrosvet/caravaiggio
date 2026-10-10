import { hexToRgb, perceptualPaintDistance, rgbToOklab } from "./color.ts";
import { maxPaletteColors } from "./paletteLimits.ts";
type Sample = { weight: number; r: number; g: number; b: number; lab: readonly [number, number, number] };
const hex = (sample: Sample): `#${string}` => `#${[sample.r, sample.g, sample.b].map(value => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
/** Weighted, deterministic clustering of visible photo pixels in OKLab. */
export function imagePalette(pixels: Uint8ClampedArray, count = 4, locked: readonly string[] = []): readonly `#${string}`[] {
  if (!Number.isInteger(count) || count < 1 || count > maxPaletteColors) throw new Error(`Palette size must be between 1 and ${maxPaletteColors}.`);
  const remaining = Math.max(0, count - locked.length);
  if (!remaining) return [];
  const histogram = new Map<number, { weight: number; r: number; g: number; b: number }>();
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const sample = histogram.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    sample.weight++; sample.r += r; sample.g += g; sample.b += b; histogram.set(key, sample);
  }
  const samples: Sample[] = [...histogram.values()].map(sample => {
    const rgb = { r: sample.r / sample.weight, g: sample.g / sample.weight, b: sample.b / sample.weight };
    return { ...rgb, weight: sample.weight, lab: rgbToOklab(rgb) };
  });
  if (!samples.length) return [];
  const centres = locked.map(value => rgbToOklab(hexToRgb(value)));
  const fixed = centres.length;
  while (centres.length < count) {
    let best: Sample | undefined, score = -1;
    for (const sample of samples) {
      const distance = centres.length ? Math.min(...centres.map(centre => perceptualPaintDistance(sample.lab, centre))) : 1;
      const candidate = Math.sqrt(sample.weight) * distance;
      if (candidate > score) { best = sample; score = candidate; }
    }
    if (!best || (centres.length && score < 1e-8)) break;
    centres.push(best.lab);
  }
  let groups: Sample[][] = [];
  for (let iteration = 0; iteration < 12; iteration++) {
    groups = centres.map(() => []);
    for (const sample of samples) {
      let closest = 0, distance = Infinity;
      centres.forEach((centre, index) => { const next = perceptualPaintDistance(sample.lab, centre); if (next < distance) { closest = index; distance = next; } });
      groups[closest].push(sample);
    }
    for (let index = fixed; index < centres.length; index++) {
      const group = groups[index]; const weight = group.reduce((sum, sample) => sum + sample.weight, 0);
      if (!weight) continue;
      centres[index] = [0, 1, 2].map(axis => group.reduce((sum, sample) => sum + sample.lab[axis] * sample.weight, 0) / weight) as unknown as readonly [number, number, number];
    }
  }
  const colors = groups.slice(fixed).flatMap((group, offset) => {
    if (!group.length) return [];
    const centre = centres[fixed + offset];
    const representative = group.reduce((best, sample) => perceptualPaintDistance(sample.lab, centre) < perceptualPaintDistance(best.lab, centre) ? sample : best);
    return [{ hex: hex(representative), lightness: representative.lab[0] }];
  });
  return [...new Set(colors.sort((a, b) => b.lightness - a.lightness).map(color => color.hex))].filter(color => !locked.some(value => value.toUpperCase() === color)).slice(0, remaining);
}
