import { defaultWorkspace, parseWorkspace, syncWorkspace, type Workspace } from "../core/workspace.ts";
export type CanvasSettings = Readonly<{
  widthMm: number;
  heightMm: number;
  orientation: "portrait" | "landscape";
  units: "mm";
}>;

export type SourceImage = Readonly<{
  name: string;
  mimeType: "image/png" | "image/jpeg";
  widthPx: number;
  heightPx: number;
  dataUrl: string;
}>;

export type PaletteColor = Readonly<{
  id: string;
  name: string;
  hex: `#${string}`;
  locked: boolean;
  skipPainting: boolean;
  restricted: boolean;
  hueToleranceDeg: number;
  minimumChroma: number;
}>;

export type PosterizationSettings = Readonly<{
  detail: number;
  smoothing: number;
  minimumRegionPx: number;
}>;

export type SourceTransform = Readonly<{
  offsetXPercent: number;
  offsetYPercent: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
}>;

type CaravaiggioProjectV1 = Readonly<{
  format: "caravaiggio-project";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvas: Omit<CanvasSettings, "units">;
  sourceImage: SourceImage | null;
}>;

export type CaravaiggioProject = Readonly<
  Omit<CaravaiggioProjectV1, "version" | "canvas"> & {
    version: 8;
    canvas: CanvasSettings;
    palette: readonly PaletteColor[];
    workspace: Workspace;
    posterization: PosterizationSettings;
    brush: BrushProfile;
    strokeSettings: StrokeGenerationSettings;
    sourceTransform: SourceTransform;
  }
>;

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validateImage(value: unknown): SourceImage | null {
  if (value === null) return null;
  if (!record(value))
    throw new Error("The project contains an invalid source image.");
  if (
    typeof value.name !== "string" ||
    !["image/png", "image/jpeg"].includes(String(value.mimeType))
  )
    throw new Error("The project contains an unsupported source image type.");
  if (
    !positive(value.widthPx) ||
    !positive(value.heightPx) ||
    typeof value.dataUrl !== "string" ||
    !value.dataUrl.startsWith(`data:${value.mimeType};base64,`)
  )
    throw new Error("The project contains corrupted source image data.");
  return value as SourceImage;
}

function common(value: Record<string, unknown>) {
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name.trim()
  )
    throw new Error("The project does not have a valid identity.");
  if (
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    Number.isNaN(Date.parse(value.updatedAt))
  )
    throw new Error("The project does not have valid timestamps.");
  if (
    !record(value.canvas) ||
    !positive(value.canvas.widthMm) ||
    !positive(value.canvas.heightMm)
  )
    throw new Error("Canvas dimensions must be positive.");
  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    canvas: value.canvas,
    sourceImage: validateImage(value.sourceImage),
  };
}

function normalize(value: Record<string, unknown>): CaravaiggioProject {
  const data = common(value);
  const version = Number(value.version);
  if (
    (value.version === 2 ||
      value.version === 3 ||
      value.version === 4 ||
      value.version === 5 ||
      value.version === 6 ||
      value.version === 7 || value.version === 8) &&
    data.canvas.units !== "mm"
  )
    throw new Error("The project uses unsupported units.");
  const widthMm = data.canvas.widthMm as number;
  const heightMm = data.canvas.heightMm as number;
  const palette =
    version >= 3 ? validatePalette(value.palette, version) : defaultPalette();
  const posterization =
    version >= 3
      ? validatePosterization(value.posterization)
      : defaultPosterization();
  const brush = version >= 5 ? validateBrush(value.brush) : defaultBrush();
  const strokeSettings =
    version >= 5
      ? validateStrokeSettings(value.strokeSettings)
      : defaultStrokeSettings();
  const sourceTransform =
    version >= 7
      ? validateSourceTransform(value.sourceTransform)
      : version === 6
        ? migrateSourceTransformV6(value.sourceTransform)
        : defaultSourceTransform();
  return {
    format: "caravaiggio-project",
    version: 8,
    id: data.id,
    name: data.name,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    canvas: {
      widthMm,
      heightMm,
      orientation: widthMm > heightMm ? "landscape" : "portrait",
      units: "mm",
    },
    sourceImage: data.sourceImage,
    palette,
    workspace: syncWorkspace(parseWorkspace(value.workspace, { widthMm, heightMm }), { widthMm, heightMm }, palette),
    posterization,
    brush,
    strokeSettings,
    sourceTransform,
  };
}

const hexColor = /^#[0-9a-f]{6}$/i;

function defaultPalette(): readonly PaletteColor[] {
  return [
    {
      id: "titanium-white",
      name: "Titanium White",
      hex: "#F4F0E6",
      locked: false,
      skipPainting: true,
      restricted: false,
      hueToleranceDeg: 30,
      minimumChroma: 0.04,
    },
    {
      id: "ivory-black",
      name: "Ivory Black",
      hex: "#1B1918",
      locked: false,
      skipPainting: false,
      restricted: false,
      hueToleranceDeg: 30,
      minimumChroma: 0.04,
    },
    {
      id: "cadmium-red",
      name: "Cadmium Red",
      hex: "#B7352D",
      locked: false,
      skipPainting: false,
      restricted: false,
      hueToleranceDeg: 30,
      minimumChroma: 0.04,
    },
    {
      id: "ultramarine-blue",
      name: "Ultramarine Blue",
      hex: "#274C8E",
      locked: false,
      skipPainting: false,
      restricted: false,
      hueToleranceDeg: 30,
      minimumChroma: 0.04,
    },
  ];
}

function defaultPosterization(): PosterizationSettings {
  return { detail: 50, smoothing: 20, minimumRegionPx: 24 };
}

function validatePalette(
  value: unknown,
  version: number,
): readonly PaletteColor[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    throw new Error("The palette must contain between 1 and 8 colors.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (
      !record(entry) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      typeof entry.hex !== "string" ||
      !hexColor.test(entry.hex) ||
      typeof entry.locked !== "boolean"
    )
      throw new Error("The project contains an invalid palette color.");
    ids.add(entry.id);
    const restricted = version >= 4 ? entry.restricted : false;
    const skipPainting =
      typeof entry.skipPainting === "boolean" ? entry.skipPainting : false;
    const hueToleranceDeg = version >= 4 ? entry.hueToleranceDeg : 30;
    const minimumChroma = version >= 4 ? entry.minimumChroma : 0.04;
    if (
      typeof restricted !== "boolean" ||
      typeof hueToleranceDeg !== "number" ||
      hueToleranceDeg < 1 ||
      hueToleranceDeg > 180 ||
      typeof minimumChroma !== "number" ||
      minimumChroma < 0 ||
      minimumChroma > 0.4
    )
      throw new Error("The project contains invalid palette matching rules.");
    return {
      id: entry.id,
      name: entry.name,
      hex: entry.hex.toUpperCase() as `#${string}`,
      locked: entry.locked,
      skipPainting,
      restricted,
      hueToleranceDeg,
      minimumChroma,
    };
  });
}

function validatePosterization(value: unknown): PosterizationSettings {
  if (
    !record(value) ||
    !positive(value.detail) ||
    value.detail > 100 ||
    typeof value.smoothing !== "number" ||
    value.smoothing < 0 ||
    value.smoothing > 100 ||
    typeof value.minimumRegionPx !== "number" ||
    !Number.isInteger(value.minimumRegionPx) ||
    value.minimumRegionPx < 0
  )
    throw new Error("The project contains invalid posterization settings.");
  return {
    detail: value.detail,
    smoothing: value.smoothing,
    minimumRegionPx: value.minimumRegionPx,
  } as PosterizationSettings;
}

const defaultBrush = (): BrushProfile => ({
  name: "Flat brush 10 mm",
  shape: "flat",
  widthMm: 10,
});
const defaultStrokeSettings = (): StrokeGenerationSettings => ({
  style: "realism",
  seed: "",
  geometry: "curved",
  curvature: 0.18,
  strokeLengthMm: 65,
  minStrokeLengthMm: 12,
  maxStrokeLengthMm: 75,
  paintLoadLengthMm: 120,
  direction: "horizontal",
  overlap: 0.2,
  speedMmPerMin: 600,
  pressure: 0.5,
});

function validateBrush(value: unknown): BrushProfile {
  if (
    !record(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    (value.shape !== "flat" && value.shape !== "round") ||
    !positive(value.widthMm)
  )
    throw new Error("The project contains an invalid brush profile.");
  return value as BrushProfile;
}

function validateStrokeSettings(value: unknown): StrokeGenerationSettings {
  if (
    !record(value) ||
    !["horizontal", "vertical", "random", "flow", "image-contours"].includes(
      String(value.direction),
    ) ||
    typeof value.overlap !== "number" ||
    value.overlap < 0 ||
    value.overlap >= 1 ||
    !positive(value.speedMmPerMin) ||
    typeof value.pressure !== "number" ||
    value.pressure < 0 ||
    value.pressure > 1
  )
    throw new Error("The project contains invalid stroke settings.");
  const styles = [
    "realism",
    "impressionism",
    "expressionism",
    "pointillism",
    "abstract",
  ];
  const style =
    typeof value.style === "string" && styles.includes(value.style)
      ? (value.style as StrokeGenerationSettings["style"])
      : "realism";
  const seed = typeof value.seed === "string" ? value.seed : "";
  const geometries = ["linear", "curved", "contour", "mixed"];
  const geometry =
    typeof value.geometry === "string" && geometries.includes(value.geometry)
      ? (value.geometry as StrokeGenerationSettings["geometry"])
      : "curved";
  const curvature =
    typeof value.curvature === "number" &&
    value.curvature >= 0 &&
    value.curvature <= 1
      ? value.curvature
      : 0.18;
  const paintLoadLengthMm =
    typeof value.paintLoadLengthMm === "number" &&
    value.paintLoadLengthMm >= 10 &&
    value.paintLoadLengthMm <= 5000
      ? value.paintLoadLengthMm
      : 120;
  const strokeLengthMm =
    typeof value.strokeLengthMm === "number" &&
    value.strokeLengthMm >= 1 &&
    value.strokeLengthMm <= 500
      ? value.strokeLengthMm
      : 65;
  const minStrokeLengthMm =
    typeof value.minStrokeLengthMm === "number" &&
    value.minStrokeLengthMm >= 1 &&
    value.minStrokeLengthMm <= 500
      ? value.minStrokeLengthMm
      : Math.max(1, strokeLengthMm * 0.2);
  const maxStrokeLengthMm =
    typeof value.maxStrokeLengthMm === "number" &&
    value.maxStrokeLengthMm >= minStrokeLengthMm &&
    value.maxStrokeLengthMm <= 500
      ? value.maxStrokeLengthMm
      : strokeLengthMm;
  return {
    ...value,
    style,
    seed,
    geometry,
    curvature,
    strokeLengthMm,
    minStrokeLengthMm,
    maxStrokeLengthMm,
    paintLoadLengthMm,
    contourSmoothing: typeof value.contourSmoothing === "number" && Number.isFinite(value.contourSmoothing) ? Math.max(0, Math.min(1, value.contourSmoothing)) : 0.5,
    contourSensitivity: typeof value.contourSensitivity === "number" && Number.isFinite(value.contourSensitivity) ? Math.max(0, Math.min(1, value.contourSensitivity)) : 0.5,
    contourGapMm: typeof value.contourGapMm === "number" && Number.isFinite(value.contourGapMm) ? Math.max(0, Math.min(10, value.contourGapMm)) : 2,
    joinNearbyStrokes: typeof value.joinNearbyStrokes === "boolean" ? value.joinNearbyStrokes : true,
  } as StrokeGenerationSettings;
}

const defaultSourceTransform = (): SourceTransform => ({
  offsetXPercent: 0,
  offsetYPercent: 0,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
});

function validateSourceTransform(value: unknown): SourceTransform {
  if (
    !record(value) ||
    typeof value.offsetXPercent !== "number" ||
    typeof value.offsetYPercent !== "number" ||
    typeof value.scaleX !== "number" ||
    value.scaleX <= 0 ||
    typeof value.scaleY !== "number" ||
    value.scaleY <= 0 ||
    typeof value.rotationDeg !== "number"
  )
    throw new Error("The project contains an invalid source transform.");
  return value as SourceTransform;
}

function migrateSourceTransformV6(value: unknown): SourceTransform {
  if (
    !record(value) ||
    typeof value.offsetXPercent !== "number" ||
    typeof value.offsetYPercent !== "number" ||
    typeof value.scale !== "number" ||
    value.scale <= 0 ||
    typeof value.rotationDeg !== "number"
  )
    throw new Error("The project contains an invalid source transform.");
  return {
    offsetXPercent: value.offsetXPercent,
    offsetYPercent: value.offsetYPercent,
    scaleX: value.scale,
    scaleY: value.scale,
    rotationDeg: value.rotationDeg,
  };
}

export function createProject(name = "New painting"): CaravaiggioProject {
  const now = new Date().toISOString();
  return {
    format: "caravaiggio-project",
    version: 8,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    canvas: {
      widthMm: 300,
      heightMm: 400,
      orientation: "portrait",
      units: "mm",
    },
    sourceImage: null,
    palette: defaultPalette(),
    workspace: syncWorkspace(defaultWorkspace({ widthMm: 300, heightMm: 400 }), { widthMm: 300, heightMm: 400 }, defaultPalette()),
    posterization: defaultPosterization(),
    brush: defaultBrush(),
    strokeSettings: defaultStrokeSettings(),
    sourceTransform: defaultSourceTransform(),
  };
}

export function parseProject(input: string): CaravaiggioProject {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("The file does not contain valid project JSON.");
  }
  if (!record(value) || value.format !== "caravaiggio-project")
    throw new Error("The file does not contain a valid project.");
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(Number(value.version)))
    throw new Error("Unsupported project format or version.");
  return normalize(value);
}

export function serializeProject(project: CaravaiggioProject): string {
  return JSON.stringify(
    { ...project, updatedAt: new Date().toISOString() },
    null,
    2,
  );
}
import type {
  BrushProfile,
  StrokeGenerationSettings,
} from "../core/strokes.ts";
