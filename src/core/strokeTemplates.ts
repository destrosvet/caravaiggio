import { strokeStylePresets } from "./strokes.ts";
import type { BrushProfile, StrokeGenerationSettings } from "./strokes.ts";
export type StrokeTemplate = Readonly<{ id: string; name: string; description: string; brush: BrushProfile; settings: StrokeGenerationSettings }>;
const base = strokeStylePresets.realism.settings;
export const paintingStyleTemplates: readonly StrokeTemplate[] = [
  { id: "realism", name: "Realism", description: "Fine, restrained curves closely follow the source image structure.",
    brush: strokeStylePresets.realism.brush,
    settings: { ...strokeStylePresets.realism.settings, templateId: "realism", strategy: "flow-curves", joinNearbyStrokes: false,
      minStrokeLengthMm: 4, strategyParameters: { fieldRadius: 3, imageInfluence: 1, angle: 0, bend: .1, wavelengthMm: 70, turnLimit: .08 } } },
  { id: "impressionism", name: "Impressionism", description: "Loose individual brush impressions with varied placement and direction.",
    brush: strokeStylePresets.impressionism.brush,
    settings: { ...strokeStylePresets.impressionism.settings, templateId: "impressionism", strategy: "dabs", joinNearbyStrokes: false,
      minStrokeLengthMm: 3, strategyParameters: { spacing: .85, length: 1.8, jitter: .45, angle: 30, angleVariation: 100 } } },
  { id: "expressionism", name: "Expressionism", description: "Broad, strongly bending strokes with a loose relationship to the image structure.",
    brush: strokeStylePresets.expressionism.brush,
    settings: { ...strokeStylePresets.expressionism.settings, templateId: "expressionism", strategy: "flow-curves", joinNearbyStrokes: false,
      minStrokeLengthMm: 8, strategyParameters: { fieldRadius: 6, imageInfluence: .3, angle: 55, bend: .8, wavelengthMm: 90, turnLimit: .22 } } },
  { id: "pointillism", name: "Pointillism", description: "Dense, small round dabs with subtle position variation.",
    brush: strokeStylePresets.pointillism.brush,
    settings: { ...strokeStylePresets.pointillism.settings, templateId: "pointillism", strategy: "dabs", joinNearbyStrokes: false,
      strategyParameters: { spacing: .7, length: .6, jitter: .2, angle: 0, angleVariation: 180 } } },
  { id: "abstract", name: "Abstract", description: "Bold repeating waves and curls shaped by an editable geometric pattern.",
    brush: strokeStylePresets.abstract.brush,
    settings: { ...strokeStylePresets.abstract.settings, templateId: "abstract", strategy: "decorative-lines", joinNearbyStrokes: false,
      minStrokeLengthMm: 4, strategyParameters: { spacingMm: 10, amplitudeMm: 12, wavelengthMm: 90, angle: 35, curl: .8 } } },
];
export const strokeTemplates: readonly StrokeTemplate[] = [
  { id: "flow-curves", name: "Flow curves", description: "Long curves follow the structure of the source image. Inspired by flow-curves.jpg.",
    brush: { name: "Flow flat 6 mm", shape: "flat", widthMm: 6 }, settings: { ...base, templateId: "flow-curves", strategy: "flow-curves", strategyParameters: {}, minStrokeLengthMm: 4, maxStrokeLengthMm: 90, joinNearbyStrokes: false } },
  { id: "curved-offsets", name: "Curved offsets", description: "Nested curves around colour shapes. Inspired by cruved-offsets.jpg.",
    brush: { name: "Offset round 5 mm", shape: "round", widthMm: 5 }, settings: { ...base, templateId: "curved-offsets", strategy: "curved-offsets", strategyParameters: {}, minStrokeLengthMm: 3, maxStrokeLengthMm: 120, joinNearbyStrokes: false } },
  { id: "colour-dabs", name: "Colour dabs", description: "Separate short brush impressions. Inspired by halftone-points.webp.",
    brush: { name: "Dab flat 8 mm", shape: "flat", widthMm: 8 }, settings: { ...base, style: "pointillism", templateId: "colour-dabs", strategy: "dabs", strategyParameters: {}, minStrokeLengthMm: 1, maxStrokeLengthMm: 25, joinNearbyStrokes: false } },
  { id: "decorative-lines", name: "Decorative flowing lines", description: "Fine waves and curls inspired by sgraffito.jpg. These are painted lines, not scratched grooves.",
    brush: { name: "Detail round 2 mm", shape: "round", widthMm: 2 }, settings: { ...base, templateId: "decorative-lines", strategy: "decorative-lines", strategyParameters: {}, minStrokeLengthMm: 3, maxStrokeLengthMm: 150, joinNearbyStrokes: false } },
  ...paintingStyleTemplates,
];
export function applyStrokeTemplate(template: StrokeTemplate, seed: string) {
  return { brush: { ...template.brush }, strokeSettings: { ...template.settings, templateId: template.id, strategyParameters: { ...template.settings.strategyParameters }, seed } };
}
