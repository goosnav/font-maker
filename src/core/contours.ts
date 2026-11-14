import { EM, EXTENT, ORIGIN_X, TOP, type Point } from "./model";
// Edges follow the ink boundary; opposite shared edges are never emitted.
export function traceMask(
  alpha: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 127,
): Point[][] {
  const edges = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (width + 1) + x;
  const filled = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    alpha[y * width + x] > threshold;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const list = edges.get(k) || [];
    list.push(key(bx, by));
    edges.set(k, list);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (filled(x, y)) {
        if (!filled(x, y - 1)) add(x + 1, y, x, y);
        if (!filled(x - 1, y)) add(x, y, x, y + 1);
        if (!filled(x, y + 1)) add(x, y + 1, x + 1, y + 1);
        if (!filled(x + 1, y)) add(x + 1, y + 1, x + 1, y);
      }
  const contours: Point[][] = [];
  while (edges.size) {
    const start = edges.keys().next().value!;
    let current = start,
      previous: number | undefined;
    const points: Point[] = [];
    let guard = 0;
    do {
      points.push([current % (width + 1), Math.floor(current / (width + 1))]);
      const nexts = edges.get(current);
      if (!nexts?.length) break;
      let choice = nexts.length - 1;
      if (previous !== undefined && nexts.length > 1) {
        const dx = (current % (width + 1)) - (previous % (width + 1)),
          dy =
            Math.floor(current / (width + 1)) -
            Math.floor(previous / (width + 1));
        let turn = Infinity;
        nexts.forEach((n, i) => {
          const nx = (n % (width + 1)) - (current % (width + 1)),
            ny =
              Math.floor(n / (width + 1)) - Math.floor(current / (width + 1));
          const cross = dx * ny - dy * nx;
          if (cross < turn) {
            turn = cross;
            choice = i;
          }
        });
      }
      const next = nexts.splice(choice, 1)[0];
      if (!nexts.length) edges.delete(current);
      previous = current;
      current = next;
      if (++guard > width * height * 4)
        throw Error("Character outline is too complex.");
    } while (current !== start);
    const reduced = points.filter((p, i) => {
      const a = points[(i + points.length - 1) % points.length],
        b = points[(i + 1) % points.length];
      return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
    });
    if (reduced.length >= 3)
      contours.push(
        reduced.map(([x, y]) => [
          ORIGIN_X + (x * EXTENT) / width,
          TOP - (y * EXTENT) / height,
        ]),
      );
  }
  return contours;
}
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 3 || tolerance <= 0) return points;
  const open = [...points, points[0]];
  function reduce(pts: Point[]): Point[] {
    if (pts.length < 3) return pts;
    let max = 0,
      index = 0;
    const a = pts[0],
      b = pts.at(-1)!,
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i],
        t = Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
              (dx * dx + dy * dy || 1),
          ),
        );
      const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    return max > tolerance
      ? [
          ...reduce(pts.slice(0, index + 1)).slice(0, -1),
          ...reduce(pts.slice(index)),
        ]
      : [a, b];
  }
  const result = reduce(open).slice(0, -1);
  return result.length >= 3 ? result : points;
}
export function maskAdvance(
  contours: Point[][],
  spacing: number,
  resolution: number,
) {
  const xs = contours.flat().map((p) => p[0]);
  const step = EM / resolution;
  return Math.max(
    step,
    Math.round(((xs.length ? Math.max(...xs) : 1024) + spacing) / step) * step,
  );
}
