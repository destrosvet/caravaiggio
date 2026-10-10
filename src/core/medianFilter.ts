/** Edge-preserving RGB median with a physical radius. Alpha and transparent masks stay intact.
 * Sliding histograms keep work proportional to radius rather than kernel area.
 */
export function medianFilterPixels(source: Uint8ClampedArray, width: number, height: number,
  canvas: { widthMm: number; heightMm: number }, radiusMm: number): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || source.length !== width * height * 4 ||
      !Number.isFinite(radiusMm) || radiusMm < 0 || radiusMm > 8 ||
      ![canvas.widthMm, canvas.heightMm].every(v => Number.isFinite(v) && v > 0)) throw new Error("Invalid median filter input.");
  if (radiusMm === 0) return source;
  const rx = Math.min(width - 1, Math.round(radiusMm / canvas.widthMm * width));
  const ry = Math.min(height - 1, Math.round(radiusMm / canvas.heightMm * height));
  if (!rx && !ry) return source;
  const result = new Uint8ClampedArray(source);
  for (let y = 0; y < height; y++) {
    const hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
    const median = [0, 0, 0], below = [0, 0, 0];
    let count = 0;
    const column = (x: number, sign: number) => {
      if (x < 0 || x >= width) return;
      for (let yy = Math.max(0, y - ry); yy <= Math.min(height - 1, y + ry); yy++) {
        const offset = (yy * width + x) * 4;
        if (source[offset + 3] < 16) continue;
        count += sign;
        for (let c = 0; c < 3; c++) { const value = source[offset + c]; hist[c][value] += sign; if (value < median[c]) below[c] += sign; }
      }
    };
    for (let x = 0; x <= rx; x++) column(x, 1);
    for (let x = 0; x < width; x++) {
      if (x) { column(x - rx - 1, -1); column(x + rx, 1); }
      if (!count) continue;
      const target = Math.floor(count / 2), offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        while (median[c] > 0 && below[c] > target) { median[c]--; below[c] -= hist[c][median[c]]; }
        while (median[c] < 255 && below[c] + hist[c][median[c]] <= target) { below[c] += hist[c][median[c]]; median[c]++; }
        if (source[offset + 3] >= 16) result[offset + c] = median[c];
      }
    }
  }
  return result;
}
