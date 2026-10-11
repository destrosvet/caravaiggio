import type { ColorRegionMap } from "./strokes.ts";
/** Remove sub-brush colour noise using constant-time local histograms. */
export function brushScaleMap(map: ColorRegionMap, canvas: Readonly<{ widthMm: number; heightMm: number }>, brushWidth: number): ColorRegionMap {
  const radiusX = Math.floor(brushWidth * 0.4 / canvas.widthMm * map.widthPx);
  const radiusY = Math.floor(brushWidth * 0.4 / canvas.heightMm * map.heightPx);
  if (radiusX < 1 && radiusY < 1) return map;
  const width = map.widthPx, height = map.heightPx, stride = width + 1;
  let pixels = new Uint8Array(map.pixels);
  for (let pass = 0; pass < 2; pass++) {
    const tables = map.paintIds.map(() => new Int32Array((width + 1) * (height + 1)));
    for (let paint = 0; paint < tables.length; paint++) {
      const table = tables[paint];
      for (let y = 1; y <= height; y++) {
        let row = 0;
        for (let x = 1; x <= width; x++) { row += pixels[(y - 1) * width + x - 1] === paint ? 1 : 0; table[y * stride + x] = table[(y - 1) * stride + x] + row; }
      }
    }
    const next = new Uint8Array(pixels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, current = pixels[index];
      if (current >= tables.length || map.recognitionMap?.[index]) continue; // preserve canvas/transparent masks
      const left = Math.max(0, x - radiusX), right = Math.min(width, x + radiusX + 1), top = Math.max(0, y - radiusY), bottom = Math.min(height, y + radiusY + 1);
      const counts = tables.map(table => table[bottom * stride + right] - table[top * stride + right] - table[bottom * stride + left] + table[top * stride + left]);
      let best = current;
      counts.forEach((count, paint) => { if (count > counts[best]) best = paint; });
      // Keep coherent features; only suppress colours poorly represented
      // inside the physical brush footprint.
      const total = counts.reduce((sum, count) => sum + count, 0);
      if (counts[current] < total * 0.4) next[index] = best;
    }
    pixels = next;
  }
  return { ...map, pixels };
}
