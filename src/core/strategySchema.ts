export type StrategyId = "legacy" | "flow-curves" | "curved-offsets" | "dabs" | "decorative-lines";
export type StrategyParameter = Readonly<{ key: string; label: string; min: number; max: number; step: number; default: number; unit?: string }>;
export const strategySchemas: Record<Exclude<StrategyId, "legacy">, { name: string; description: string; parameters: readonly StrategyParameter[] }> = {
  "flow-curves": { name: "Flow curves", description: "Continuous curves follow image structure. Adjust the field, bending and spacing.", parameters: [
    { key: "fieldRadius", label: "Field smoothing radius", min: 1, max: 12, step: 1, default: 4, unit: "px" },
    { key: "imageInfluence", label: "Follow image structure", min: 0, max: 1, step: .05, default: .85 },
    { key: "angle", label: "Base direction", min: 0, max: 180, step: 1, default: 20, unit: "°" },
    { key: "bend", label: "Organic bending", min: 0, max: 1, step: .05, default: .35 },
    { key: "wavelengthMm", label: "Bend wavelength", min: 5, max: 200, step: 1, default: 55, unit: "mm" },
    { key: "turnLimit", label: "Maximum turn per mm", min: .01, max: .5, step: .01, default: .12 },
  ] },
  "curved-offsets": { name: "Curved offsets", description: "Nested curves follow the boundary of each colour region, like contour lines.", parameters: [
    { key: "spacing", label: "Distance between curves", min: .4, max: 2, step: .05, default: .8, unit: "× brush" },
    { key: "inset", label: "First curve inset", min: .1, max: 1.5, step: .05, default: .55, unit: "× brush" },
    { key: "smoothing", label: "Curve smoothing passes", min: 0, max: 6, step: 1, default: 2 },
  ] },
  dabs: { name: "Colour dabs", description: "Short individual brush impressions; density, jitter and orientation are independent.", parameters: [
    { key: "spacing", label: "Dab spacing", min: .5, max: 3, step: .05, default: 1.1, unit: "× brush" },
    { key: "length", label: "Dab length", min: .1, max: 3, step: .05, default: .65, unit: "× brush" },
    { key: "jitter", label: "Position jitter", min: 0, max: .9, step: .05, default: .35 },
    { key: "angle", label: "Base direction", min: 0, max: 180, step: 1, default: 30, unit: "°" },
    { key: "angleVariation", label: "Direction variation", min: 0, max: 180, step: 1, default: 80, unit: "°" },
  ] },
  "decorative-lines": { name: "Decorative flowing lines", description: "Spaced waves and curls inspired by sgraffito, painted with a detail brush.", parameters: [
    { key: "spacingMm", label: "Line spacing", min: 2, max: 40, step: .5, default: 8, unit: "mm" },
    { key: "amplitudeMm", label: "Wave amplitude", min: 0, max: 30, step: .5, default: 4, unit: "mm" },
    { key: "wavelengthMm", label: "Wavelength", min: 10, max: 200, step: 1, default: 65, unit: "mm" },
    { key: "angle", label: "Pattern direction", min: 0, max: 180, step: 1, default: 10, unit: "°" },
    { key: "curl", label: "Curl strength", min: 0, max: 1, step: .05, default: .45 },
  ] },
};
export function strategyParameters(strategy: StrategyId, value: unknown = {}): Record<string, number> {
  if (strategy === "legacy") return {};
  if (!(strategy in strategySchemas)) throw new Error("Unknown trajectory strategy.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid strategy parameters.");
  const supplied = value as Record<string, unknown>;
  const schema = strategySchemas[strategy];
  for (const key of Object.keys(supplied)) if (!schema.parameters.some(p => p.key === key)) throw new Error(`Unknown parameter ${key}.`);
  return Object.fromEntries(schema.parameters.map(p => {
    const v = supplied[p.key] ?? p.default;
    if (typeof v !== "number" || !Number.isFinite(v) || v < p.min || v > p.max || (p.step === 1 && !Number.isInteger(v))) throw new Error(`Invalid strategy parameter ${p.key}.`);
    return [p.key, v];
  }));
}
