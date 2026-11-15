import { describe, it, expect } from "vitest";
import { traceSmooth, fitCurves, cubicPoint } from "../src/core/curves";
import { EXTENT, ORIGIN_X, TOP, type Point } from "../src/core/model";
const area = (p: Point[]) =>
  p.reduce(
    (a, v, i) =>
      a + v[0] * p[(i + 1) % p.length][1] - v[1] * p[(i + 1) % p.length][0],
    0,
  ) / 2;
describe("detailed outlines", () => {
  it("retains counters and disconnected accents with opposite contour winding", () => {
    const n = 64,
      alpha = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 36);
        alpha[y * n + x] =
          (d < 20 && d > 12) || (x >= 29 && x < 35 && y >= 4 && y < 7)
            ? 255
            : 0;
      }
    const paths = traceSmooth(alpha, n, n);
    expect(paths).toHaveLength(3);
    expect(paths.filter((p) => area(p) > 0)).toHaveLength(2);
    expect(paths.filter((p) => area(p) < 0)).toHaveLength(1);
  });
  it("fits curved alpha edges to within one source pixel without collapsing fine features", () => {
    const n = 256,
      radius = 91,
      alpha = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        alpha[y * n + x] = Math.round(
          255 *
            Math.max(
              0,
              Math.min(
                1,
                radius + 0.5 - Math.hypot(x + 0.5 - 128, y + 0.5 - 128),
              ),
            ),
        );
    const paths = traceSmooth(alpha, n, n);
    expect(paths).toHaveLength(1);
    const fit = fitCurves(paths[0], (EXTENT / n) * 0.35);
    expect(fit.segments.some((s) => s.c1)).toBe(true);
    expect(fit.segments.length).toBeLessThan(80);
    let prev = fit.start,
      maxError = 0;
    for (const segment of fit.segments) {
      for (let t = 0; t <= 1; t += 0.025) {
        const p = segment.c1
          ? cubicPoint(prev, segment.c1, segment.c2!, segment.end, t)
          : [
              prev[0] + (segment.end[0] - prev[0]) * t,
              prev[1] + (segment.end[1] - prev[1]) * t,
            ];
        const x = ((p[0] - ORIGIN_X) * n) / EXTENT - 128,
          y = ((TOP - p[1]) * n) / EXTENT - 128;
        maxError = Math.max(maxError, Math.abs(Math.hypot(x, y) - radius));
      }
      prev = segment.end;
    }
    expect(maxError).toBeLessThan(0.8);
    expect(fit.segments.at(-1)!.end).toEqual(fit.start);
    const tiny = traceSmooth(
      new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0]),
      3,
      3,
    );
    expect(tiny).toHaveLength(1);
    expect(fitCurves(tiny[0], 0.1).segments.length).toBeGreaterThan(1);
  });
});
