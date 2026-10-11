import { medianFilterPixels } from "./medianFilter.ts";

export const AI_POSTERIZATION_VERSION = 5;

export type AiPosterizationSettings = Readonly<{
  backgroundRadiusMm: number;
  detailProtection: number;
  faceShadeCount?: number;
  fillGaps?: boolean;
}>;
export const defaultAiPosterizationSettings: AiPosterizationSettings = {
  backgroundRadiusMm: 3,
  detailProtection: .9,
};
export type AiImportanceMask = Readonly<{
  width: number;
  height: number;
  values: Uint8Array;
  subjects: number;
  details: number;
  recognition?: Uint8Array;
  faceMask?: Uint8Array;
  faces?: number;
  recognitionDetails?: number;
  humanDetails?: number;
  hairDetails?: number;
  accessoryDetails?: number;
}>;

export function validateAiPosterization(value: unknown): AiPosterizationSettings {
  if (value === undefined) return defaultAiPosterizationSettings;
  const settings = value as AiPosterizationSettings;
  if (!settings || !Number.isFinite(settings.backgroundRadiusMm) || settings.backgroundRadiusMm < 0 || settings.backgroundRadiusMm > 8 ||
      !Number.isFinite(settings.detailProtection) || settings.detailProtection < 0 || settings.detailProtection > 1) {
    throw Error("Invalid AI posterization settings.");
  }
  if (settings.faceShadeCount !== undefined && (!Number.isInteger(settings.faceShadeCount) || settings.faceShadeCount < 0 || settings.faceShadeCount > 8)) throw Error("Invalid additional face shade count.");
  if(settings.fillGaps!==undefined && typeof settings.fillGaps!=="boolean")throw Error("Invalid gap fill setting.");
  return { ...(settings.fillGaps!==undefined?{fillGaps:settings.fillGaps}:{}), backgroundRadiusMm: settings.backgroundRadiusMm, detailProtection: settings.detailProtection, ...(settings.faceShadeCount !== undefined ? {faceShadeCount: settings.faceShadeCount} : {}) };
}

/** Max pooling keeps narrow detected features when reducing mask resolution. */
export function resizeImportance(mask: AiImportanceMask, width: number, height: number): Uint8Array {
  if (![mask.width, mask.height, width, height].every(value => Number.isInteger(value) && value > 0) || mask.values.length !== mask.width * mask.height) {
    throw Error("Invalid AI importance mask.");
  }
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * mask.width / width);
      const x1 = Math.min(mask.width, Math.max(x0 + 1, Math.ceil((x + 1) * mask.width / width)));
      const y0 = Math.floor(y * mask.height / height);
      const y1 = Math.min(mask.height, Math.max(y0 + 1, Math.ceil((y + 1) * mask.height / height)));
      let maximum = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) maximum = Math.max(maximum, mask.values[yy * mask.width + xx]);
      }
      result[y * width + x] = maximum;
    }
  }
  return result;
}

/** AI controls simplification; it never generates new geometry, palette colours or alpha. */
export function prepareAiPosterization(source: Uint8ClampedArray, width: number, height: number,
  canvas: { widthMm: number; heightMm: number }, mask: AiImportanceMask, settings: AiPosterizationSettings): Uint8ClampedArray {
  validateAiPosterization(settings);
  const simplified = medianFilterPixels(source, width, height, canvas, settings.backgroundRadiusMm);
  const importance = resizeImportance(mask, width, height);
  const recognition = mask.recognition ? resizeImportance({ ...mask, values: mask.recognition }, width, height) : undefined;
  const result = new Uint8ClampedArray(source);
  for (let i = 0; i < importance.length; i++) {
    const identity = (recognition?.[i] ?? 0) / 255;
    const preserve = Math.max(identity, importance[i] / 255 * settings.detailProtection);
    for (let channel = 0; channel < 3; channel++) {
      result[i * 4 + channel] = Math.round(source[i * 4 + channel] * preserve + simplified[i * 4 + channel] * (1 - preserve) + .15 * identity * (source[i * 4 + channel] - simplified[i * 4 + channel]));
    }
  }
  return result;
}
