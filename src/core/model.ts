export type Point = Readonly<{ x: number; y: number }>;

export type Move = Readonly<{
  type: "move";
  to: Point;
  speedMmPerMin?: number;
}>;

export type Stroke = Readonly<{
  type: "stroke";
  phase?: "underpainting" | "contours" | "shadows" | "recognition";
  points: readonly [Point, Point, ...Point[]];
  paintId: string;
  pressure: number;
  speedMmPerMin: number;
  expectedLoadStart: number;
  expectedLoadEnd: number;
}>;

export type Wait = Readonly<{ type: "wait"; seconds: number }>;
export type Park = Readonly<{ type: "park" }>;
export type PaintOperation = Move | Stroke | Wait | Park;

export type PaintingPlan = Readonly<{
  formatVersion: 1;
  projectId: string;
  coverageStats?: Readonly<{strokes:number;uncoveredBefore:number;uncoveredAfter:number}>;
  recognitionStats?: Readonly<{ strokes: number; components: number; pixels: number }>;
  shadowStats?: Readonly<{ strokes: number; eligiblePixels: number; noDarkerPaintSeeds: number }>;
  generationStats?: Readonly<{ omittedShortStrokes: number; minLengthMm: number; maxLengthMm: number }>;
  operations: readonly PaintOperation[];
}>;

export type MachineProfile = Readonly<{
  name: string;
  workAreaMm: Readonly<{ width: number; height: number }>;
  safeZMm: number;
  paintZRangeMm: Readonly<{ min: number; max: number }>;
  travelSpeedMmPerMin: number;
  park: Readonly<Point & { z: number }>;
}>;
