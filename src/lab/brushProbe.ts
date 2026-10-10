import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PaintRaster, paintSimulationDefaults } from "../core/paintRaster.ts";
import { encodePng } from "./png.ts";

// Paired smooth/textured curved strokes with many trajectory segments.
const width = 720, height = 400, rgba = new Uint8ClampedArray(width * height * 4);
for (const [row, shape] of (["round", "flat"] as const).entries()) for (let column = 0; column < 2; column++) {
  const raster = new PaintRaster(360, 200, { widthMm: 180, heightMm: 100 }, { name: "Probe", shape, widthMm: 12 }, [{ id: "green", hex: "#52623a" }],
    { ...paintSimulationDefaults, bristle: column ? .35 : 0, pickup: 0 });
  for (let line = 0; line < 3; line++) {
    raster.load("green");
    const point = (x: number) => ({ x, y: 23 + line * 25 + 8 * Math.sin(x / 35 + line) });
    for (let i = 0; i < 240; i++) raster.stroke(point(10 + i * 160 / 240), point(10 + (i + 1) * 160 / 240), "green", .65, 1 - i / 400, 1 - (i + 1) / 400, i / 60, (i + 1) / 60);
  }
  for (let y = 0; y < 200; y++) rgba.set(raster.rgba.subarray(y * 360 * 4, (y + 1) * 360 * 4), ((row * 200 + y) * width + column * 360) * 4);
}
const out = resolve("artifacts/brush-probe"); await mkdir(out, { recursive: true });
await writeFile(resolve(out, "brush-texture.png"), encodePng(width, height, rgba));
console.log(resolve(out, "brush-texture.png"));
