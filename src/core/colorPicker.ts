import { hexToRgb } from "./color.ts";
export function hexToHsv(hex: string): readonly [number, number, number] {
  const rgb = hexToRgb(hex);
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, max === 0 ? 0 : delta / max * 100, max * 100];
}
export function hsvToHex(h: number, s: number, v: number): `#${string}` {
  const hue = ((h % 360) + 360) % 360 / 60;
  const value = Math.max(0, Math.min(100, v)) / 100;
  const chroma = value * Math.max(0, Math.min(100, s)) / 100;
  const x = chroma * (1 - Math.abs(hue % 2 - 1)), m = value - chroma;
  const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${channels.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
