import { EXTENT, ORIGIN_X, TOP, type Point } from "./model";
import { simplify } from "./contours";
export type CurveSegment = { end: Point; c1?: Point; c2?: Point };
export type CurvePath = { start: Point; segments: CurveSegment[] };

// Interpolate the half-opacity boundary instead of tracing square pixel edges.
export function traceSmooth(
  alpha: Uint8Array,
  width: number,
  height: number,
): Point[][] {
  const edges = new Map<number, { point: Point; next: number }>();
  const value = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : alpha[y * width + x];
  const key = (x: number, y: number, vertical: number) =>
    ((y + 1) * (width + 2) + x + 1) * 2 + vertical;
  const fraction = (a: number, b: number) => (127.5 - a) / (b - a);
  const pairs: Record<number, number[][]> = {
    1: [[3, 0]],
    2: [[0, 1]],
    3: [[3, 1]],
    4: [[1, 2]],
    5: [
      [3, 0],
      [1, 2],
    ],
    6: [[0, 2]],
    7: [[3, 2]],
    8: [[2, 3]],
    9: [[2, 0]],
    10: [
      [0, 1],
      [2, 3],
    ],
    11: [[2, 1]],
    12: [[1, 3]],
    13: [[1, 0]],
    14: [[0, 3]],
  };
  for (let y = -1; y < height; y++)
    for (let x = -1; x < width; x++) {
      const a = value(x, y),
        b = value(x + 1, y),
        c = value(x + 1, y + 1),
        d = value(x, y + 1);
      const mask =
        (a > 127.5 ? 1 : 0) |
        (b > 127.5 ? 2 : 0) |
        (c > 127.5 ? 4 : 0) |
        (d > 127.5 ? 8 : 0);
      if (!mask || mask === 15) continue;
      const ids = [
        key(x, y, 0),
        key(x + 1, y, 1),
        key(x, y + 1, 0),
        key(x, y, 1),
      ];
      const point = (edge: number): Point => {
        if (edge === 0) return [x + 0.5 + fraction(a, b), y + 0.5];
        if (edge === 1) return [x + 1.5, y + 0.5 + fraction(b, c)];
        if (edge === 2) return [x + 0.5 + fraction(d, c), y + 1.5];
        return [x + 0.5, y + 0.5 + fraction(a, d)];
      };
      for (const [from, to] of pairs[mask])
        edges.set(ids[from], { point: point(from), next: ids[to] });
    }
  const paths: Point[][] = [];
  while (edges.size) {
    const start = edges.keys().next().value!;
    let current = start;
    const path: Point[] = [];
    do {
      const edge = edges.get(current);
      if (!edge) throw Error("Could not close a detailed outline.");
      edges.delete(current);
      path.push([
        ORIGIN_X + (edge.point[0] * EXTENT) / width,
        TOP - (edge.point[1] * EXTENT) / height,
      ]);
      current = edge.next;
    } while (current !== start);
    if (path.length >= 3) paths.push(path);
  }
  return paths;
}
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Point, s: number): Point => [a[0] * s, a[1] * s];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const norm = (a: Point): Point => mul(a, 1 / (Math.hypot(...a) || 1));
export function cubicPoint(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  t: number,
): Point {
  const s = 1 - t;
  return add(
    add(mul(a, s * s * s), mul(b, 3 * s * s * t)),
    add(mul(c, 3 * s * t * t), mul(d, t * t * t)),
  );
}
/** Least-squares cubic fitting with recursive error bounds and shared split tangents. */
export function fitCurves(contour: Point[], tolerance: number): CurvePath {
  const pts = simplify(contour, tolerance / 3),
    start = pts[0];
  let split = 1;
  for (let i = 2; i < pts.length; i++)
    if (
      Math.hypot(...sub(pts[i], start)) > Math.hypot(...sub(pts[split], start))
    )
      split = i;
  const fit = (
    p: Point[],
    left: Point,
    right: Point,
    depth = 0,
  ): CurveSegment[] => {
    const first = p[0],
      last = p.at(-1)!,
      chord = sub(last, first),
      distance = Math.hypot(...chord);
    if (p.length === 2) return [{ end: last }];
    const u = [0];
    for (let i = 1; i < p.length; i++)
      u.push(u[i - 1] + Math.hypot(...sub(p[i], p[i - 1])));
    const total = u.at(-1)!;
    for (let i = 1; i < u.length; i++) u[i] /= total || 1;
    let c00 = 0,
      c01 = 0,
      c11 = 0,
      x0 = 0,
      x1 = 0;
    for (let i = 0; i < p.length; i++) {
      const t = u[i],
        s = 1 - t,
        b0 = s * s * s,
        b1 = 3 * t * s * s,
        b2 = 3 * t * t * s,
        b3 = t * t * t;
      const a1 = mul(left, b1),
        a2 = mul(right, b2),
        v = sub(p[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
      c00 += dot(a1, a1);
      c01 += dot(a1, a2);
      c11 += dot(a2, a2);
      x0 += dot(a1, v);
      x1 += dot(a2, v);
    }
    const det = c00 * c11 - c01 * c01;
    let l = det ? (x0 * c11 - x1 * c01) / det : 0,
      r = det ? (c00 * x1 - c01 * x0) / det : 0;
    if (
      l < distance * 1e-6 ||
      r < distance * 1e-6 ||
      l > distance * 2 ||
      r > distance * 2
    )
      l = r = distance / 3;
    const c1 = add(first, mul(left, l)),
      c2 = add(last, mul(right, r));
    let error = 0,
      middle = Math.floor(p.length / 2);
    for (let i = 1; i < p.length - 1; i++) {
      const e = Math.hypot(...sub(cubicPoint(first, c1, c2, last, u[i]), p[i]));
      if (e > error) {
        error = e;
        middle = i;
      }
    }
    if (error <= tolerance) return [{ c1, c2, end: last }];
    if (depth > 30) return p.slice(1).map((end) => ({ end }));
    const tangent = norm(sub(p[middle - 1], p[middle + 1]));
    return [
      ...fit(p.slice(0, middle + 1), left, tangent, depth + 1),
      ...fit(p.slice(middle), mul(tangent, -1), right, depth + 1),
    ];
  };
  const a = pts.slice(0, split + 1),
    b = [...pts.slice(split), start];
  return {
    start,
    segments: [
      ...fit(a, norm(sub(a[1], start)), norm(sub(a.at(-2)!, a.at(-1)!))),
      ...fit(b, norm(sub(b[1], b[0])), norm(sub(b.at(-2)!, start))),
    ],
  };
}
