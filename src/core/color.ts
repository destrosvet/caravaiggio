export type Rgb = Readonly<{ r: number; g: number; b: number }>;
export type PaletteMatch = Readonly<{
  hex: string;
  restricted?: boolean;
  hueToleranceDeg?: number;
  minimumChroma?: number;
}>;

const channel = (value: number) => {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function hexToHsl(hex: string): readonly [number, number, number] {
  const { r: red, g: green, b: blue } = hexToRgb(hex);
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, Math.round(lightness * 100)];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return [
    Math.round(hue),
    Math.round(saturation * 100),
    Math.round(lightness * 100),
  ];
}

export function hslToHex(
  hue: number,
  saturation: number,
  lightness: number,
): `#${string}` {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] =
    segment < 1
      ? [chroma, x, 0]
      : segment < 2
        ? [x, chroma, 0]
        : segment < 3
          ? [0, chroma, x]
          : segment < 4
            ? [0, x, chroma]
            : segment < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = l - chroma / 2;
  const hex = [r1, g1, b1]
    .map((value) =>
      Math.round((value + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${hex.toUpperCase()}`;
}

export function rgbToOklab(color: Rgb): readonly [number, number, number] {
  const r = channel(color.r);
  const g = channel(color.g);
  const b = channel(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function perceptualPaintDistance(
  source: readonly [number, number, number],
  candidate: readonly [number, number, number],
): number {
  const lightnessDelta = source[0] - candidate[0];
  const sourceChroma = Math.hypot(source[1], source[2]);
  const candidateChroma = Math.hypot(candidate[1], candidate[2]);
  const chromaDelta = sourceChroma - candidateChroma;
  const axisDistance =
    (source[1] - candidate[1]) ** 2 + (source[2] - candidate[2]) ** 2;
  const hueDistance = Math.max(0, axisDistance - chromaDelta ** 2);
  // A muted candidate must not win just because its chroma is closer.
  // Compare hue directions independently of candidate chroma, with a
  // smooth fade near neutral source pixels where hue is unreliable.
  const hueConfidence = Math.min(1, sourceChroma / 0.08) ** 2;
  const hueAlignment = sourceChroma > 1e-6 && candidateChroma > 0.02
    ? Math.max(-1, Math.min(1,
        (source[1] * candidate[1] + source[2] * candidate[2]) /
        (sourceChroma * candidateChroma)))
    : 0;
  const hueDirectionPenalty = 0.12 * hueConfidence * (1 - hueAlignment);
  const neutralPenalty =
    sourceChroma < 0.035 && candidateChroma > 0.075
      ? (candidateChroma - sourceChroma) ** 2 * 8
      : 0;
  return (
    lightnessDelta ** 2 * 0.45 +
    chromaDelta ** 2 * 2.2 +
    hueDistance * 3.2 +
    hueDirectionPenalty +
    neutralPenalty
  );
}

const hueDegrees = (lab: readonly [number, number, number]) =>
  ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360;

function isEligible(
  source: readonly [number, number, number],
  candidate: readonly [number, number, number],
  paint: PaletteMatch,
): boolean {
  if (!paint.restricted) return true;
  const sourceChroma = Math.hypot(source[1], source[2]);
  if (sourceChroma < (paint.minimumChroma ?? 0.04)) return false;
  const difference = Math.abs(hueDegrees(source) - hueDegrees(candidate));
  const circularDifference = Math.min(difference, 360 - difference);
  return circularDifference <= (paint.hueToleranceDeg ?? 30);
}

function nearestPaletteMatch(
  color: Rgb,
  palette: readonly (string | PaletteMatch)[],
): Readonly<{ color: Rgb; index: number }> {
  if (!palette.length) throw new Error("A palette color is required.");
  const source = rgbToOklab(color);
  const paints = palette.map((paint, index) => ({
    ...(typeof paint === "string" ? { hex: paint } : paint),
    index,
  }));
  const eligible = paints.filter((paint) =>
    isEligible(source, rgbToOklab(hexToRgb(paint.hex)), paint),
  );
  // Keep chromatic pixels in their dominant RGB hue family when that
  // family exists in the eligible palette. This prevents muted earth tones
  // from replacing foliage just because their saturation is closer.
  const hueFamily = (rgb: Rgb) =>
    rgb.g >= rgb.r && rgb.g > rgb.b ? "green"
      : rgb.b > rgb.r && rgb.b >= rgb.g ? "blue" : "red";
  const sameFamily = Math.hypot(source[1], source[2]) >= 0.04
    ? eligible.filter(paint => {
        const rgb = hexToRgb(paint.hex);
        const lab = rgbToOklab(rgb);
        return hueFamily(rgb) === hueFamily(color) && Math.hypot(lab[1], lab[2]) >= 0.04;
      })
    : [];
  const hueCandidates = sameFamily.length ? sameFamily : eligible;
  const candidates = hueCandidates.length
    ? hueCandidates
    : paints.filter((paint) => !paint.restricted);
  const fallback = candidates.length ? candidates : paints;
  let nearest = hexToRgb(fallback[0].hex);
  let nearestIndex = fallback[0].index;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const paint of fallback) {
    const candidate = hexToRgb(paint.hex);
    const lab = rgbToOklab(candidate);
    const distance = perceptualPaintDistance(source, lab);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestIndex = paint.index;
      nearestDistance = distance;
    }
  }
  return { color: nearest, index: nearestIndex };
}

export function nearestPaletteColor(
  color: Rgb,
  palette: readonly (string | PaletteMatch)[],
): Rgb {
  return nearestPaletteMatch(color, palette).color;
}

export function nearestPaletteIndex(
  color: Rgb,
  palette: readonly (string | PaletteMatch)[],
): number {
  return nearestPaletteMatch(color, palette).index;
}

export function posterizePixels(
  pixels: Uint8ClampedArray,
  palette: readonly (string | PaletteMatch)[],
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(pixels);
  const cache = new Map<number, Rgb>();
  for (let index = 0; index < result.length; index += 4) {
    const key =
      (result[index] << 16) | (result[index + 1] << 8) | result[index + 2];
    let nearest = cache.get(key);
    if (!nearest) {
      nearest = nearestPaletteColor(
        { r: result[index], g: result[index + 1], b: result[index + 2] },
        palette,
      );
      cache.set(key, nearest);
    }
    result[index] = nearest.r;
    result[index + 1] = nearest.g;
    result[index + 2] = nearest.b;
  }
  return result;
}
