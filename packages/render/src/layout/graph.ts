/**
 * layout/graph.ts — deterministic force-directed autolayout for the node-edge
 * state-graph view, plus the pure edge-path geometry (curved reciprocal
 * edges, self-loop arcs, label anchors). Pure math — unit-tested in node.
 */

import type { Id } from '@math-ai/core';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface GraphLayoutOpts {
  readonly width: number;
  readonly height: number;
  readonly iterations?: number;
  readonly padding?: number;
}

/**
 * Deterministic force layout: nodes start evenly on a circle (input order),
 * then relax under spring (edges), repulsion (all pairs), and center gravity
 * with linear cooling. Same inputs → same positions, always.
 */
export function layoutGraph(
  nodeIds: readonly Id[],
  edges: ReadonlyArray<{ readonly from: Id; readonly to: Id }>,
  opts: GraphLayoutOpts,
): Map<Id, Point> {
  const { width, height } = opts;
  const iterations = opts.iterations ?? 200;
  const padding = opts.padding ?? 36;
  const n = nodeIds.length;
  const cx = width / 2;
  const cy = height / 2;
  const out = new Map<Id, Point>();
  if (n === 0) return out;
  if (n === 1) {
    out.set(nodeIds[0]!, { x: cx, y: cy });
    return out;
  }

  const r0 = Math.min(width, height) / 2 - padding;
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  nodeIds.forEach((_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    xs[i] = cx + r0 * Math.cos(angle);
    ys[i] = cy + r0 * Math.sin(angle);
  });

  const index = new Map<Id, number>(nodeIds.map((id, i) => [id, i]));
  const springs: Array<readonly [number, number]> = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue; // self-loops exert no force
    springs.push([a, b]);
  }

  const area = width * height;
  const k = Math.sqrt(area / n) * 0.7; // ideal spacing
  for (let it = 0; it < iterations; it += 1) {
    const cool = 1 - it / iterations;
    const maxMove = 0.12 * Math.min(width, height) * cool + 1;
    const dx = new Array<number>(n).fill(0);
    const dy = new Array<number>(n).fill(0);
    // pairwise repulsion
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let vx = xs[i]! - xs[j]!;
        let vy = ys[i]! - ys[j]!;
        let d2 = vx * vx + vy * vy;
        if (d2 < 1e-6) {
          // deterministic tie-break: nudge along index difference
          vx = 0.01 * (i - j);
          vy = 0.013 * (i + 1);
          d2 = vx * vx + vy * vy;
        }
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        dx[i]! += (vx / d) * f;
        dy[i]! += (vy / d) * f;
        dx[j]! -= (vx / d) * f;
        dy[j]! -= (vy / d) * f;
      }
    }
    // springs
    for (const [a, b] of springs) {
      const vx = xs[a]! - xs[b]!;
      const vy = ys[a]! - ys[b]!;
      const d = Math.max(Math.sqrt(vx * vx + vy * vy), 1e-3);
      const f = (d * d) / k;
      dx[a]! -= (vx / d) * f;
      dy[a]! -= (vy / d) * f;
      dx[b]! += (vx / d) * f;
      dy[b]! += (vy / d) * f;
    }
    // gravity + apply with cooling clamp
    for (let i = 0; i < n; i += 1) {
      dx[i]! += (cx - xs[i]!) * 0.03;
      dy[i]! += (cy - ys[i]!) * 0.03;
      const len = Math.max(Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!), 1e-9);
      const move = Math.min(len, maxMove);
      xs[i] = xs[i]! + (dx[i]! / len) * move;
      ys[i] = ys[i]! + (dy[i]! / len) * move;
      xs[i] = Math.min(width - padding, Math.max(padding, xs[i]!));
      ys[i] = Math.min(height - padding, Math.max(padding, ys[i]!));
    }
  }

  nodeIds.forEach((id, i) => out.set(id, { x: xs[i]!, y: ys[i]! }));
  return out;
}

/**
 * Bend per edge, index-aligned with `edges`.
 *
 * Directed graphs keep the reciprocal rule this module always had: an edge
 * whose reverse also exists bows by 16 so the pair never overlaps. Undirected
 * graphs have no reciprocals — one edge JOINS a pair — so the rule becomes:
 * parallel edges over the same unordered pair fan out (first straight, then
 * ±16, ±32, …). Self-loops always report 0 (they have their own geometry).
 */
export function edgeBends(
  edges: ReadonlyArray<{ readonly from: Id; readonly to: Id }>,
  directed: boolean,
): readonly number[] {
  if (directed) {
    const present = new Set(edges.map((e) => `${e.from}->${e.to}`));
    return edges.map((e) =>
      e.from === e.to ? 0 : present.has(`${e.to}->${e.from}`) ? 16 : 0,
    );
  }
  const pairKey = (e: { readonly from: Id; readonly to: Id }): string =>
    e.from < e.to ? `${e.from}~${e.to}` : `${e.to}~${e.from}`;
  const counts = new Map<string, number>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = pairKey(e);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return edges.map((e) => {
    if (e.from === e.to) return 0;
    const key = pairKey(e);
    if ((counts.get(key) ?? 0) < 2) return 0;
    const i = seen.get(key) ?? 0;
    seen.set(key, i + 1);
    // 0th straight, then 16, -16, 32, -32, …
    if (i === 0) return 0;
    const magnitude = 16 * Math.ceil(i / 2);
    return i % 2 === 1 ? magnitude : -magnitude;
  });
}

export interface EdgeGeometry {
  /** SVG path `d`, endpoints trimmed to the node radius. */
  readonly path: string;
  /** Where the edge label sits. */
  readonly label: Point;
}

/**
 * Path for a self-loop: a circular arc on the node's outward side (`dir`, a
 * unit vector, default straight up), entering and leaving the node circle.
 * Label just beyond the arc. Views point `dir` away from the graph center so
 * a bottom node's loop hangs below it instead of colliding with edges.
 */
export function selfLoopGeometry(
  at: Point,
  nodeRadius: number,
  dir: Point = { x: 0, y: -1 },
): EdgeGeometry {
  const r = nodeRadius;
  const loopR = r * 0.85;
  const a = 0.55; // radians off `dir` for the attach points
  const len = Math.max(Math.hypot(dir.x, dir.y), 1e-6);
  const ux = dir.x / len;
  const uy = dir.y / len;
  const rotate = (angle: number): Point => ({
    x: ux * Math.cos(angle) - uy * Math.sin(angle),
    y: ux * Math.sin(angle) + uy * Math.cos(angle),
  });
  const d1 = rotate(-a);
  const d2 = rotate(a);
  const p1: Point = { x: at.x + r * d1.x, y: at.y + r * d1.y };
  const p2: Point = { x: at.x + r * d2.x, y: at.y + r * d2.y };
  const path = `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${loopR.toFixed(2)} ${loopR.toFixed(2)} 0 1 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  const labelDist = r + 2 * loopR + 6;
  return { path, label: { x: at.x + ux * labelDist, y: at.y + uy * labelDist } };
}

/**
 * Path between two distinct nodes: straight when `bend` is 0, a quadratic
 * curve bowed perpendicular otherwise (reciprocal edges get opposite bends so
 * they never overlap). Endpoints trim to the node circles.
 */
export function edgeGeometry(
  from: Point,
  to: Point,
  nodeRadius: number,
  bend: number,
): EdgeGeometry {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const d = Math.max(Math.sqrt(vx * vx + vy * vy), 1e-6);
  const ux = vx / d;
  const uy = vy / d;
  // perpendicular
  const px = -uy;
  const py = ux;
  const mx = (from.x + to.x) / 2 + px * bend;
  const my = (from.y + to.y) / 2 + py * bend;
  // trim endpoints toward the control point so arrows meet the circle
  const trim = (p: Point, c: Point): Point => {
    const tx = c.x - p.x;
    const ty = c.y - p.y;
    const tl = Math.max(Math.sqrt(tx * tx + ty * ty), 1e-6);
    return { x: p.x + (tx / tl) * nodeRadius, y: p.y + (ty / tl) * nodeRadius };
  };
  const control: Point = { x: mx, y: my };
  const a = trim(from, bend === 0 ? to : control);
  const b = trim(to, bend === 0 ? from : control);
  const path =
    bend === 0
      ? `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
      : `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${mx.toFixed(2)} ${my.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  // label: on the curve apex, offset a little further out
  const off = bend === 0 ? 10 : bend + Math.sign(bend) * 10 || 10;
  const label: Point = { x: (from.x + to.x) / 2 + px * off, y: (from.y + to.y) / 2 + py * off };
  return { path, label };
}
