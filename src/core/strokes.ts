import { contourDirectionField, imageContourStrokes } from "./imageContours.ts";
import { brushScaleMap } from "./brushScaleMap.ts";
import { joinNearbyStrokes } from "./strokeJoining.ts";
import type { PaintingPlan, Stroke } from "./model.ts";
import { generateReferenceStrokes } from "./referenceStrategies.ts";
import type { StrategyId } from "./strategySchema.ts";
import type { PaintSimulationSettings } from "./paintRaster.ts";
import { addShadowStrokes, type ShadowSettings, type ShadowPaint } from "./shadows.ts";
import type { PrioritySettings } from "./priority.ts";

export type BrushProfile = Readonly<{
  name: string;
  shape: "flat" | "round";
  widthMm: number;
}>;

export type StrokeGenerationSettings = Readonly<{
  templateId?: string;
  strategy?: StrategyId;
  strategyParameters?: Readonly<Record<string, number>>;
  paintSimulation?: PaintSimulationSettings;
  shadows?: ShadowSettings;
  priority?: PrioritySettings;
  style:
    | "realism"
    | "impressionism"
    | "expressionism"
    | "pointillism"
    | "abstract";
  seed: string;
  geometry: "linear" | "curved" | "contour" | "mixed";
  curvature: number;
  strokeLengthMm?: number;
  minStrokeLengthMm?: number;
  maxStrokeLengthMm?: number;
  paintLoadLengthMm?: number;
  joinNearbyStrokes?: boolean;
  direction: "horizontal" | "vertical" | "random" | "flow" | "image-contours";
  contourSmoothing?: number;
  contourSensitivity?: number;
  contourGapMm?: number;
  overlap: number;
  speedMmPerMin: number;
  pressure: number;
}>;

export const strokeStylePresets: Readonly<
  Record<
    StrokeGenerationSettings["style"],
    Readonly<{ brush: BrushProfile; settings: StrokeGenerationSettings }>
  >
> = {
  realism: {
    brush: { name: "Fine flat brush 6 mm", shape: "flat", widthMm: 6 },
    settings: {
      style: "realism",
      seed: "",
      geometry: "curved",
      curvature: 0.18,
      strokeLengthMm: 65,
      minStrokeLengthMm: 12,
      maxStrokeLengthMm: 75,
      paintLoadLengthMm: 140,
      direction: "flow",
      overlap: 0.35,
      speedMmPerMin: 400,
      pressure: 0.45,
    },
  },
  impressionism: {
    brush: { name: "Round brush 8 mm", shape: "round", widthMm: 8 },
    settings: {
      style: "impressionism",
      seed: "",
      geometry: "curved",
      curvature: 0.4,
      strokeLengthMm: 45,
      minStrokeLengthMm: 8,
      maxStrokeLengthMm: 55,
      paintLoadLengthMm: 90,
      direction: "flow",
      overlap: 0.15,
      speedMmPerMin: 700,
      pressure: 0.5,
    },
  },
  expressionism: {
    brush: { name: "Bold flat brush 14 mm", shape: "flat", widthMm: 14 },
    settings: {
      style: "expressionism",
      seed: "",
      geometry: "mixed",
      curvature: 0.65,
      strokeLengthMm: 100,
      minStrokeLengthMm: 20,
      maxStrokeLengthMm: 130,
      paintLoadLengthMm: 180,
      direction: "random",
      overlap: 0.05,
      speedMmPerMin: 950,
      pressure: 0.75,
    },
  },
  pointillism: {
    brush: { name: "Round detail brush 4 mm", shape: "round", widthMm: 4 },
    settings: {
      style: "pointillism",
      seed: "",
      geometry: "linear",
      curvature: 0,
      strokeLengthMm: 3,
      minStrokeLengthMm: 1,
      maxStrokeLengthMm: 5,
      paintLoadLengthMm: 35,
      direction: "random",
      overlap: 0.4,
      speedMmPerMin: 500,
      pressure: 0.35,
    },
  },
  abstract: {
    brush: { name: "Flat brush 12 mm", shape: "flat", widthMm: 12 },
    settings: {
      style: "abstract",
      seed: "",
      geometry: "mixed",
      curvature: 0.8,
      strokeLengthMm: 85,
      minStrokeLengthMm: 12,
      maxStrokeLengthMm: 110,
      paintLoadLengthMm: 150,
      direction: "random",
      overlap: 0.2,
      speedMmPerMin: 800,
      pressure: 0.6,
    },
  },
};

export type ColorRegionMap = Readonly<{
  widthPx: number;
  heightPx: number;
  paintIds: readonly string[];
  pixels: Uint8Array;
  luminance?: Float32Array;
  palette?: readonly ShadowPaint[];
  sourceRgba?: Uint8ClampedArray;
  priorityMap?: Float32Array;
}>;

export function generateParallelStrokes(
  projectId: string,
  map: ColorRegionMap,
  canvas: Readonly<{ widthMm: number; heightMm: number }>,
  brush: BrushProfile,
  settings: StrokeGenerationSettings,
): PaintingPlan {
  if (map.pixels.length !== map.widthPx * map.heightPx)
    throw new Error("Color map dimensions do not match its pixel data.");
  if (brush.widthMm <= 0) throw new Error("Brush width must be positive.");
  if (settings.overlap < 0 || settings.overlap >= 1)
    throw new Error("Stroke overlap must be between 0 and 1.");
  const spacingMm = brush.widthMm * (1 - settings.overlap);
  const horizontal = settings.direction === "horizontal";
  const crossPixels = horizontal ? map.heightPx : map.widthPx;
  const crossMm = horizontal ? canvas.heightMm : canvas.widthMm;
  const alongPixels = horizontal ? map.widthPx : map.heightPx;
  const alongMm = horizontal ? canvas.widthMm : canvas.heightMm;
  const lineStep = Math.max(1, Math.round((spacingMm / crossMm) * crossPixels));
  const strokes: Stroke[] = [];
  let reverse = false;

  for (
    let cross = Math.floor(lineStep / 2);
    cross < crossPixels;
    cross += lineStep
  ) {
    let start = 0;
    while (start < alongPixels) {
      const x = horizontal ? start : cross;
      const y = horizontal ? cross : start;
      const paintIndex = map.pixels[y * map.widthPx + x];
      let end = start + 1;
      while (end < alongPixels) {
        const nextX = horizontal ? end : cross;
        const nextY = horizontal ? cross : end;
        if (map.pixels[nextY * map.widthPx + nextX] !== paintIndex) break;
        end++;
      }
      const paintId = map.paintIds[paintIndex];
      if (paintId && end - start >= 2) {
        const alongStart = (start / alongPixels) * alongMm;
        const alongEnd = (end / alongPixels) * alongMm;
        const crossPosition = (cross / crossPixels) * crossMm;
        const first = horizontal
          ? { x: alongStart, y: crossPosition }
          : { x: crossPosition, y: alongStart };
        const last = horizontal
          ? { x: alongEnd, y: crossPosition }
          : { x: crossPosition, y: alongEnd };
        strokes.push({
          type: "stroke",
          points: reverse ? [last, first] : [first, last],
          paintId,
          pressure: settings.pressure,
          speedMmPerMin: settings.speedMmPerMin,
          expectedLoadStart: 1,
          expectedLoadEnd: 0.8,
        });
        reverse = !reverse;
      }
      start = end;
    }
  }
  return { formatVersion: 1, projectId, operations: strokes };
}

const seedFrom = (value: string) => {
  let seed = 2166136261;
  for (const character of value)
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
};

const randomFrom = (seed: number) => {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
};

function boundaryDistanceField(map: ColorRegionMap): Float32Array {
  const distance = new Float32Array(map.pixels.length);
  const same = (x: number, y: number, paint: number) =>
    x >= 0 &&
    y >= 0 &&
    x < map.widthPx &&
    y < map.heightPx &&
    map.pixels[y * map.widthPx + x] === paint;
  for (let y = 0; y < map.heightPx; y++)
    for (let x = 0; x < map.widthPx; x++) {
      const paint = map.pixels[y * map.widthPx + x];
      distance[y * map.widthPx + x] =
        same(x - 1, y, paint) &&
        same(x + 1, y, paint) &&
        same(x, y - 1, paint) &&
        same(x, y + 1, paint)
          ? 1e6
          : 0;
    }
  const relax = (
    x: number,
    y: number,
    neighbors: readonly [number, number, number][],
  ) => {
    const offset = y * map.widthPx + x;
    for (const [dx, dy, cost] of neighbors) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (!same(nextX, nextY, map.pixels[offset])) continue;
      distance[offset] = Math.min(
        distance[offset],
        distance[nextY * map.widthPx + nextX] + cost,
      );
    }
  };
  for (let y = 0; y < map.heightPx; y++)
    for (let x = 0; x < map.widthPx; x++)
      relax(x, y, [
        [-1, 0, 1],
        [0, -1, 1],
        [-1, -1, 1.414],
        [1, -1, 1.414],
      ]);
  for (let y = map.heightPx - 1; y >= 0; y--)
    for (let x = map.widthPx - 1; x >= 0; x--)
      relax(x, y, [
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 1.414],
        [-1, 1, 1.414],
      ]);
  return distance;
}

export function generateStyledStrokes(
  projectId: string, map: ColorRegionMap, canvas: Readonly<{ widthMm: number; heightMm: number }>, brush: BrushProfile, settings: StrokeGenerationSettings,
): PaintingPlan {
  return addShadowStrokes(generateBaseStrokes(projectId, map, canvas, brush, settings), map, canvas, brush, settings);
}

function generateBaseStrokes(
  projectId: string,
  map: ColorRegionMap,
  canvas: Readonly<{ widthMm: number; heightMm: number }>,
  brush: BrushProfile,
  settings: StrokeGenerationSettings,
): PaintingPlan {
  if (settings.strategy && settings.strategy !== "legacy") return generateReferenceStrokes(projectId, map, canvas, brush, settings);
  if (map.pixels.length !== map.widthPx * map.heightPx)
    throw new Error("Color map dimensions do not match its pixel data.");
  if (brush.widthMm <= 0) throw new Error("Brush width must be positive.");
  if (settings.overlap < 0 || settings.overlap >= 1)
    throw new Error("Stroke overlap must be between 0 and 1.");
  const contourMap = map;
  const contourField = settings.direction === "image-contours" ? contourDirectionField(map, settings) : undefined;
  if (settings.style !== "pointillism") map = brushScaleMap(map, canvas, brush.widthMm);
  const requestedSeed = settings.seed.trim();
  const generationSeed = requestedSeed || `${Date.now()}:${Math.random()}`;
  const random = randomFrom(seedFrom(`${generationSeed}:${settings.style}`));
  const spacingX = Math.max(
    1,
    Math.round(
      (brush.widthMm / canvas.widthMm) * map.widthPx * (1 - settings.overlap),
    ),
  );
  const spacingY = Math.max(
    1,
    Math.round(
      (brush.widthMm / canvas.heightMm) * map.heightPx * (1 - settings.overlap),
    ),
  );
  const strokes: Stroke[] = [];
  const covered = new Uint8Array(map.widthPx * map.heightPx);
  const markCoverage = (points: Stroke["points"], paintIndex: number) => {
    const radiusX = Math.max(0.5, brush.widthMm * 0.41 / canvas.widthMm * map.widthPx);
    const radiusY = Math.max(0.5, brush.widthMm * 0.41 / canvas.heightMm * map.heightPx);
      for (let segment = 1; segment < points.length; segment++) {
        const from = points[segment - 1];
        const to = points[segment];
        const fromX = (from.x / canvas.widthMm) * map.widthPx;
        const fromY = (from.y / canvas.heightMm) * map.heightPx;
        const toX = (to.x / canvas.widthMm) * map.widthPx;
        const toY = (to.y / canvas.heightMm) * map.heightPx;
        const length = Math.hypot(toX - fromX, toY - fromY);
        const samples = Math.max(1, Math.ceil(length * 2));
        for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex++) {
          const t = sampleIndex / samples;
          const centerX = fromX + (toX - fromX) * t;
          const centerY = fromY + (toY - fromY) * t;
          const minX = Math.max(0, Math.floor(centerX - radiusX));
          const maxX = Math.min(map.widthPx - 1, Math.ceil(centerX + radiusX));
          const minY = Math.max(0, Math.floor(centerY - radiusY));
          const maxY = Math.min(map.heightPx - 1, Math.ceil(centerY + radiusY));
          for (let coverY = minY; coverY <= maxY; coverY++)
            for (let coverX = minX; coverX <= maxX; coverX++) {
              const normalizedX = (coverX + 0.5 - centerX) / radiusX;
              const normalizedY = (coverY + 0.5 - centerY) / radiusY;
              const index = coverY * map.widthPx + coverX;
              if (
                normalizedX * normalizedX + normalizedY * normalizedY <= 1 &&
                map.pixels[index] === paintIndex
              )
                covered[index] = 1;
            }
        }
      }

  };
  const boundaryDistance = boundaryDistanceField(map);
  const angleSpread =
    settings.style === "realism"
      ? Math.PI / 18
      : settings.style === "impressionism"
        ? Math.PI / 5
        : settings.style === "expressionism"
          ? Math.PI * 0.8
          : Math.PI * 2;
  const presetLengthMm =
    settings.style === "realism"
      ? 65
      : settings.style === "pointillism"
        ? 3
        : settings.style === "impressionism"
          ? 45
          : settings.style === "expressionism"
            ? 100
            : 85;
  const legacyLengthMm = settings.strokeLengthMm ?? presetLengthMm;
  const hasAdaptiveLength =
    settings.minStrokeLengthMm !== undefined ||
    settings.maxStrokeLengthMm !== undefined;
  const minLengthMm = Math.min(
    settings.minStrokeLengthMm ??
      (hasAdaptiveLength ? Math.max(1, legacyLengthMm * 0.2) : legacyLengthMm),
    settings.maxStrokeLengthMm ?? legacyLengthMm,
  );
  const maxLengthMm = Math.max(
    settings.maxStrokeLengthMm ?? legacyLengthMm,
    minLengthMm,
  );
  const minLengthPx = (minLengthMm / canvas.widthMm) * map.widthPx;
  const baseLengthPx = (maxLengthMm / canvas.widthMm) * map.widthPx;
  const alongStep = Math.max(
    1,
    Math.round(baseLengthPx * Math.max(0.35, 0.85 - settings.overlap * 0.7)),
  );
  const stepX =
    (settings.maxStrokeLengthMm !== undefined ||
      settings.strokeLengthMm !== undefined) &&
    settings.direction === "horizontal"
      ? Math.max(spacingX, alongStep)
      : spacingX;
  const stepY =
    (settings.maxStrokeLengthMm !== undefined ||
      settings.strokeLengthMm !== undefined) &&
    settings.direction === "vertical"
      ? Math.max(spacingY, alongStep)
      : spacingY;

  for (let y = Math.floor(stepY / 2); y < map.heightPx; y += stepY) {
    for (let x = Math.floor(stepX / 2); x < map.widthPx; x += stepX) {
      const paintIndex = map.pixels[y * map.widthPx + x];
      const paintId = map.paintIds[paintIndex];
      if (!paintId || covered[y * map.widthPx + x]) continue;
      const sample = (sampleX: number, sampleY: number) =>
        sampleX >= 0 &&
        sampleY >= 0 &&
        sampleX < map.widthPx &&
        sampleY < map.heightPx &&
        map.pixels[sampleY * map.widthPx + sampleX] === paintIndex;
      let momentXX = 0;
      let momentYY = 0;
      let momentXY = 0;
      for (let offsetY = -4; offsetY <= 4; offsetY++) {
        for (let offsetX = -4; offsetX <= 4; offsetX++) {
          if (!sample(x + offsetX, y + offsetY)) continue;
          momentXX += offsetX * offsetX;
          momentYY += offsetY * offsetY;
          momentXY += offsetX * offsetY;
        }
      }
      const flowAngle = 0.5 * Math.atan2(2 * momentXY, momentXX - momentYY);
      const fieldAt = (fieldX: number, fieldY: number) =>
        boundaryDistance?.[
          Math.max(0, Math.min(map.heightPx - 1, fieldY)) * map.widthPx +
            Math.max(0, Math.min(map.widthPx - 1, fieldX))
        ] ?? 0;
      const gradientX = fieldAt(x + 1, y) - fieldAt(x - 1, y);
      const gradientY = fieldAt(x, y + 1) - fieldAt(x, y - 1);
      const directionAngle =
        settings.direction === "horizontal"
          ? 0
          : settings.direction === "vertical"
            ? Math.PI / 2
            : settings.direction === "random"
              ? random() * Math.PI * 2
              : contourField?.[y * map.widthPx + x] ?? flowAngle;
      const organicAngle =
        directionAngle +
        (settings.direction === "random" ? 0 : (random() - 0.5) * angleSpread);
      const angle =
        settings.geometry === "contour" && (gradientX || gradientY)
          ? Math.atan2(gradientY, gradientX) + Math.PI / 2
          : organicAngle;
      // Let the actual colour boundary clip the path. Distance to a nearby
      // boundary does not limit how far a stroke can run along that boundary.
      const lengthPx = minLengthPx + (baseLengthPx - minLengthPx) * (0.85 + random() * 0.15);
      const half = lengthPx / 2;
      const trace = (direction: -1 | 1, limit = half) => {
        let lastX = x;
        let lastY = y;
        for (let distance = 0.25; distance <= limit; distance += 0.25) {
          const nextX = Math.round(x + Math.cos(angle) * distance * direction);
          const nextY = Math.round(y + Math.sin(angle) * distance * direction);
          if (
            nextX < 0 ||
            nextY < 0 ||
            nextX >= map.widthPx ||
            nextY >= map.heightPx ||
            map.pixels[nextY * map.widthPx + nextX] !== paintIndex
          )
            break;
          lastX = nextX;
          lastY = nextY;
        }
        return {
          x: (lastX / map.widthPx) * canvas.widthMm,
          y: (lastY / map.heightPx) * canvas.heightMm,
        };
      };
      const useCurve =
        settings.geometry === "curved" ||
        settings.geometry === "contour" ||
        (settings.geometry === "mixed" && random() > 0.35);
      let points: Stroke["points"];
      if (
        useCurve &&
        (settings.curvature > 0 || settings.geometry === "contour")
      ) {
        const curveStrength =
          settings.geometry === "contour"
            ? Math.max(0.28, settings.curvature)
            : settings.curvature;
        const bend = half * curveStrength * (random() > 0.5 ? 1 : -1);
        const runs: Array<Array<{ x: number; y: number }>> = [[]];
        const curveSteps = Math.max(16, Math.ceil(lengthPx * 4));
        for (let step = 0; step <= curveSteps; step++) {
          const t = step / curveSteps * 2 - 1;
          const along = half * t;
          const offset = bend * (1 - t * t);
          const pixelX = x + Math.cos(angle) * along - Math.sin(angle) * offset;
          const pixelY = y + Math.sin(angle) * along + Math.cos(angle) * offset;
          if (
            pixelX < 0 ||
            pixelY < 0 ||
            pixelX >= map.widthPx ||
            pixelY >= map.heightPx ||
            !sample(Math.round(pixelX), Math.round(pixelY))
          ) {
            if (runs.at(-1)?.length) runs.push([]);
            continue;
          }
          runs.at(-1)?.push({
            x: (pixelX / map.widthPx) * canvas.widthMm,
            y: (pixelY / map.heightPx) * canvas.heightMm,
          });
        }
        const longest = runs.sort((a, b) => b.length - a.length)[0];
        if (longest.length < 2) continue;
        points = [longest[0], longest[1], ...longest.slice(2)];
      } else {
        let first = trace(-1), last = trace(1);
        const pixelLength = (point: { x: number; y: number }) => Math.hypot(point.x / canvas.widthMm * map.widthPx - x, point.y / canvas.heightMm * map.heightPx - y);
        if (pixelLength(first) < half - 1) last = trace(1, lengthPx - pixelLength(first));
        else if (pixelLength(last) < half - 1) first = trace(-1, lengthPx - pixelLength(last));
        points = [first, last];
      }
      strokes.push({
        type: "stroke",
        points,
        paintId,
        pressure: Math.min(
          1,
          Math.max(0, settings.pressure * (0.85 + random() * 0.3)),
        ),
        speedMmPerMin: settings.speedMmPerMin,
        expectedLoadStart: 1,
        expectedLoadEnd: 0.9,
      });
      markCoverage(points, paintIndex);
    }
  }
  // The coarse artistic pass can be clipped to small colour islands.
  // Finish every uncovered material pixel using contiguous local runs.
  if (settings.style !== "pointillism") {
    for (let y = 0; y < map.heightPx; y++) for (let x = 0; x < map.widthPx; x++) {
      const index = y * map.widthPx + x, paintIndex = map.pixels[index];
      const paintId = map.paintIds[paintIndex];
      if (!paintId || covered[index]) continue;
      if (settings.direction === "image-contours") {
        const start = { x: (x + .5) / map.widthPx * canvas.widthMm, y: (y + .5) / map.heightPx * canvas.heightMm };
        const initial = contourField?.[index] ?? Math.PI / 4;
        const stepMm = Math.min(canvas.widthMm / map.widthPx, canvas.heightMm / map.heightPx) * .5;
        const trace = (sign: number) => {
          const result = [start]; let position = start, angle = initial + (sign < 0 ? Math.PI : 0);
          for (let distance = stepMm; distance <= maxLengthMm / 2; distance += stepMm) {
            const px = Math.floor(position.x / canvas.widthMm * map.widthPx), py = Math.floor(position.y / canvas.heightMm * map.heightPx);
            if (contourField && settings.geometry !== "linear") {
              const target = contourField[py * map.widthPx + px];
              let turn = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
              if (turn > Math.PI / 2) turn -= Math.PI;
              if (turn < -Math.PI / 2) turn += Math.PI;
              const limit = .02 + settings.curvature * .25;
              angle += Math.max(-limit, Math.min(limit, turn));
            }
            const next = { x: position.x + Math.cos(angle) * stepMm, y: position.y + Math.sin(angle) * stepMm };
            const nx = Math.floor(next.x / canvas.widthMm * map.widthPx), ny = Math.floor(next.y / canvas.heightMm * map.heightPx);
            if (nx < 0 || ny < 0 || nx >= map.widthPx || ny >= map.heightPx || map.pixels[ny * map.widthPx + nx] !== paintIndex) break;
            result.push(next); position = next;
          }
          return result;
        };
        const backward = trace(-1), forward = trace(1);
        const points = [...backward.reverse(), ...forward.slice(1)];
        if (points.length >= 2) {
          const trajectory = points as unknown as Stroke["points"];
          strokes.push({ type: "stroke", points: trajectory, paintId, pressure: settings.pressure, speedMmPerMin: settings.speedMmPerMin, expectedLoadStart: 1, expectedLoadEnd: .9 });
          markCoverage(trajectory, paintIndex);
        }
        continue;
      }
      let endX = x;
      const maxPixels = Math.max(1, Math.floor(maxLengthMm / canvas.widthMm * map.widthPx));
      while (endX + 1 < map.widthPx && endX - x + 1 < maxPixels && map.pixels[y * map.widthPx + endX + 1] === paintIndex) endX++;
      const points: Stroke["points"] = [
        { x: (x + 0.25) / map.widthPx * canvas.widthMm, y: (y + 0.5) / map.heightPx * canvas.heightMm },
        { x: (endX + 0.75) / map.widthPx * canvas.widthMm, y: (y + 0.5) / map.heightPx * canvas.heightMm },
      ];
      strokes.push({ type: "stroke", points, paintId, pressure: settings.pressure, speedMmPerMin: settings.speedMmPerMin, expectedLoadStart: 1, expectedLoadEnd: 0.9 });
      markCoverage(points, paintIndex);
    }
  }
  const operations = settings.joinNearbyStrokes !== false && settings.style !== "pointillism"
    ? joinNearbyStrokes(strokes, map, canvas, brush.widthMm, maxLengthMm)
    : strokes;
  let omittedShortStrokes = 0;
  const bounded = operations.flatMap(stroke => {
    let length = 0;
    const points = [stroke.points[0]];
    for (let index = 1; index < stroke.points.length; index++) {
      const from = stroke.points[index - 1], to = stroke.points[index];
      const segment = Math.hypot(to.x - from.x, to.y - from.y);
      if (length + segment > maxLengthMm) {
        const fraction = segment ? (maxLengthMm - length) / segment : 0;
        if (fraction > 0) points.push({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
        length = maxLengthMm; break;
      }
      points.push(to); length += segment;
    }
    if (length + 1e-6 < (settings.minStrokeLengthMm ?? 0) || points.length < 2) { omittedShortStrokes++; return []; }
    return [{ ...stroke, points: points as unknown as Stroke["points"] }];
  });
  return { formatVersion: 1, projectId, operations: settings.direction === "image-contours" ? [...bounded, ...imageContourStrokes(contourMap, canvas, settings)] : bounded, generationStats: { omittedShortStrokes, minLengthMm, maxLengthMm } };
}
