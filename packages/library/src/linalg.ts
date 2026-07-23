/**
 * linalg.ts — the linear-algebra discipline library, in USERLAND over
 * @math-ai/core. Implements spikes/determinant/api.ts's `LinAlg`:
 *
 *  - `matrix([[a,b],[c,d]])` — a 2×2 whose entries are draggable Parameters or
 *    literal numbers; each cell is a NumericHandle the matrix view projects.
 *  - `linearMap(m)` — `det = ad − bc` is a REACTIVE derived scalar (the eigen
 *    fast-path family, M5 open q c: inputs-only across the sandbox). `apply`
 *    records a per-vertex `maps-to` correspondence edge so `lesson.morph`
 *    (square → parallelogram) is legal and routes each corner; the image
 *    polygon's vertex POSITIONS are reactive, so a matrix drag deforms it live.
 *  - `unitSquare` / `basisVector` — fixed geometry.
 *  - `area(polygon)` — the SIGNED shoelace area, reactive. Its sign is the
 *    orientation, so a region view keys its fill to it: det → 0 collapses the
 *    area, det < 0 flips the sign — orientation reversal is EMERGENT, no
 *    `onCondition` verb (spikes/determinant/FINDINGS.md, FR1/FR4).
 *  - `eigen(m)` — reactive 2×2 eigen-decomposition (the sign/area story).
 *  - `compose(outer, inner)` — the product map; det(AB) = det A · det B falls
 *    out numerically because the product's entries are derived from both.
 */

import type { Handle, World } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import { constNumber, derivedNumber } from './numeric.js';

// ─────────────────────────────── types ───────────────────────────────

export interface Vector2 extends Handle<'vector'> {
  readonly x: number;
  readonly y: number;
}

export interface Matrix2 extends Handle<'matrix'> {
  cell(row: 0 | 1, col: 0 | 1): NumericHandle;
  readonly entries: readonly NumericHandle[];
}

export interface Polygon extends Handle<'polygon'> {
  readonly vertices: readonly Vector2[];
  vertex(index: number): Vector2;
  /** Reactive SIGNED area (orientation in the sign; collapses to 0 if singular). */
  readonly area: NumericHandle;
}

export interface Eigen extends Handle<'eigen'> {
  /**
   * LIVE eigenvalues, largest first. These are NumericHandles, not raw
   * numbers, so `View.readout(eig.values[0])` and `M.claim({ lhs:
   * eig.values[0] })` both work — a plain number would have thrown in the
   * first case and silently snapshotted in the second.
   */
  readonly values: readonly [NumericHandle, NumericHandle];
  readonly vectors: readonly [Vector2, Vector2];
  readonly real: boolean;
}

export interface LinearMap extends Handle<'linearMap'> {
  readonly matrix: Matrix2;
  readonly det: NumericHandle;
  apply(polygon: Polygon): Polygon;
  applyVector(v: Vector2): Vector2;
  compose(inner: LinearMap): LinearMap;
}

type Entry = NumericHandle | number;
type Row = readonly [Entry, Entry];

export interface LinAlgLib {
  matrix(rows: readonly [Row, Row]): Matrix2;
  linearMap(m: Matrix2): LinearMap;
  unitSquare(): Polygon;
  basisVector(dim: 2, axis: 0 | 1): Vector2;
  det(m: Matrix2 | LinearMap): NumericHandle;
  area(p: Polygon): NumericHandle;
  eigen(m: Matrix2 | LinearMap): Eigen;
  compose(outer: LinearMap, inner: LinearMap): LinearMap;
}

// ───────────────────────────── numerics ─────────────────────────────

/** Signed shoelace area of a simple polygon (CCW positive). */
export function signedArea(vertices: readonly { x: number; y: number }[]): number {
  let sum = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export interface Eigen2Result {
  readonly values: readonly [number, number];
  readonly vectors: readonly [{ x: number; y: number }, { x: number; y: number }];
  readonly real: boolean;
}

/** Eigenvalues/vectors of [[a,b],[c,d]]. Complex regime returns real:false. */
export function eigen2x2(a: number, b: number, c: number, d: number): Eigen2Result {
  const trace = a + d;
  const disc = trace * trace - 4 * (a * d - b * c);
  if (disc < 0) {
    // complex pair — the story never uses this regime; report real:false.
    return { values: [trace / 2, trace / 2], vectors: [{ x: 1, y: 0 }, { x: 0, y: 1 }], real: false };
  }
  const root = Math.sqrt(disc);
  const l1 = (trace + root) / 2;
  const l2 = (trace - root) / 2;
  const vecFor = (l: number): { x: number; y: number } => {
    // (A − λI) v = 0. Pick the more numerically stable row.
    if (Math.abs(b) > 1e-12 || Math.abs(a - l) > 1e-12) {
      const v = { x: b, y: l - a };
      return norm(v.x === 0 && v.y === 0 ? { x: 1, y: 0 } : v);
    }
    if (Math.abs(c) > 1e-12 || Math.abs(d - l) > 1e-12) {
      const v = { x: l - d, y: c };
      return norm(v.x === 0 && v.y === 0 ? { x: 0, y: 1 } : v);
    }
    return { x: 1, y: 0 }; // λI (scalar matrix): any vector is an eigenvector
  };
  return { values: [l1, l2], vectors: [vecFor(l1), vecFor(l2)], real: true };
}

function norm(v: { x: number; y: number }): { x: number; y: number } {
  const m = Math.hypot(v.x, v.y);
  return m > 1e-12 ? { x: v.x / m, y: v.y / m } : v;
}

// ───────────────────────────── factory ─────────────────────────────

/**
 * Mint a Matrix2 outside the LinAlg factory.
 *
 * `Field.hessian` needs to hand back a real Matrix2 — one `LinAlg.eigen` will
 * accept — without field.ts owning a second, subtly different matrix shape.
 * Exported here so there is exactly one 2x2 in the library.
 */
export function matrix2(
  world: World,
  cells: readonly [readonly [NumericHandle, NumericHandle], readonly [NumericHandle, NumericHandle]],
): Matrix2 {
  const base = world.handle('matrix');
  return Object.freeze({
    id: base.id,
    kind: 'matrix' as const,
    cell: (row: 0 | 1, col: 0 | 1): NumericHandle => cells[row]![col]!,
    entries: Object.freeze([cells[0]![0]!, cells[0]![1]!, cells[1]![0]!, cells[1]![1]!]),
  });
}

export function createLinearAlgebra(world: World): LinAlgLib {
  const wrap = (e: Entry): NumericHandle =>
    typeof e === 'number' ? constNumber(world, e) : e;

  const mkVector = (x: () => number, y: () => number): Vector2 => {
    const base = world.handle('vector');
    return Object.freeze({
      id: base.id,
      kind: 'vector' as const,
      get x(): number {
        return x();
      },
      get y(): number {
        return y();
      },
    });
  };

  const constVector = (x: number, y: number): Vector2 => mkVector(() => x, () => y);

  const mkPolygon = (vertices: readonly Vector2[]): Polygon => {
    const base = world.handle('polygon');
    const areaHandle = derivedNumber(world, () => signedArea(vertices.map((v) => ({ x: v.x, y: v.y }))), 'area');
    return Object.freeze({
      id: base.id,
      kind: 'polygon' as const,
      vertices: Object.freeze([...vertices]),
      vertex: (index: number): Vector2 => {
        const v = vertices[index];
        if (!v) throw new Error(`polygon has no vertex ${index} (of ${vertices.length})`);
        return v;
      },
      area: areaHandle,
    });
  };

  const mkMatrix = (cells: ReadonlyArray<readonly NumericHandle[]>): Matrix2 =>
    matrix2(world, [
      [cells[0]![0]!, cells[0]![1]!],
      [cells[1]![0]!, cells[1]![1]!],
    ]);

  /**
   * Narrow to a real Matrix2, or say why it is not one.
   *
   * `kind` CANNOT do this job: Prob's StochasticMatrix is also a
   * `Handle<'matrix'>` (probability.ts:61), which is deliberate — View.matrix
   * renders either — but it means TypeScript's discriminant does not separate
   * them and a `p as unknown as Matrix2` cast compiles clean. A generated
   * program did exactly that to reach for a chain's second eigenvalue.
   *
   * The failure was maximally unhelpful. `eigen` is lazy (world.derived), so
   * the cast, the call and the whole authoring pass all succeeded; the throw
   * landed a line later, on first read of `.values`, from deep inside
   * probability.ts as `matrix has no state labeled "undefined"` — because
   * StochasticMatrix.cell takes state LABELS, so cell(0, 0) asks for the state
   * named `(0).label`. Nothing in that message points at the cast.
   *
   * So: check structurally, and eagerly, at the call site. `entries` is the
   * Matrix2 member StochasticMatrix has no counterpart for.
   */
  const asMatrix = (m: Matrix2 | LinearMap): Matrix2 => {
    if (m.kind === 'linearMap') return (m as LinearMap).matrix;
    const mx = m as Matrix2;
    if (Array.isArray(mx.entries)) return mx;
    const stochastic =
      typeof (m as { valuesTracked?: unknown }).valuesTracked === 'function' ||
      (m as { states?: unknown }).states !== undefined;
    throw new Error(
      stochastic
        ? 'LinAlg wants a LinAlg.matrix, but got a Prob stochastic matrix. Both are ' +
          'kind "matrix", so a cast to Matrix2 compiles and then fails at read time ' +
          '(its cell() takes state labels, not 0/1 indices). LinAlg.eigen/det are 2x2 ' +
          'only: build one explicitly, e.g. LinAlg.matrix(p.valuesTracked() as ...), ' +
          'and for a chain\'s long-run behaviour prefer Prob.stationary(chain).'
        : 'LinAlg wants a Matrix2 (from LinAlg.matrix) or a LinearMap; got a ' +
          `kind "${String(m.kind)}" with no \`entries\`.`,
    );
  };

  const mkLinearMap = (m: Matrix2): LinearMap => {
    const a = (): number => m.cell(0, 0).value;
    const b = (): number => m.cell(0, 1).value;
    const c = (): number => m.cell(1, 0).value;
    const d = (): number => m.cell(1, 1).value;
    const det = derivedNumber(world, () => a() * d() - b() * c(), '\\det A');
    const base = world.handle('linearMap');

    const applyVector = (v: Vector2): Vector2 =>
      mkVector(() => a() * v.x + b() * v.y, () => c() * v.x + d() * v.y);

    const map: LinearMap = Object.freeze({
      id: base.id,
      kind: 'linearMap' as const,
      matrix: m,
      det,
      applyVector,
      apply: (polygon: Polygon): Polygon => {
        const imageVerts = polygon.vertices.map((sv) => {
          const iv = applyVector(sv);
          // the morph seam: square-corner → image-corner, so morph(squareView,
          // imageView) is legal and each corner travels its own maps-to route.
          world.graph.record(iv, sv, 'maps-to', 'construction');
          return iv;
        });
        return mkPolygon(imageVerts);
      },
      compose: (inner: LinearMap): LinearMap => {
        const im = inner.matrix;
        const ia = (): number => im.cell(0, 0).value;
        const ib = (): number => im.cell(0, 1).value;
        const ic = (): number => im.cell(1, 0).value;
        const id = (): number => im.cell(1, 1).value;
        // product AB, entries derived from BOTH matrices ⇒ det(AB)=detA·detB.
        const product = mkMatrix([
          [
            derivedNumber(world, () => a() * ia() + b() * ic()),
            derivedNumber(world, () => a() * ib() + b() * id()),
          ],
          [
            derivedNumber(world, () => c() * ia() + d() * ic()),
            derivedNumber(world, () => c() * ib() + d() * id()),
          ],
        ]);
        return mkLinearMap(product);
      },
    });
    return map;
  };

  const lib: LinAlgLib = {
    matrix(rows): Matrix2 {
      return mkMatrix([
        [wrap(rows[0][0]), wrap(rows[0][1])],
        [wrap(rows[1][0]), wrap(rows[1][1])],
      ]);
    },

    linearMap(m): LinearMap {
      return mkLinearMap(m);
    },

    unitSquare(): Polygon {
      return mkPolygon([constVector(0, 0), constVector(1, 0), constVector(1, 1), constVector(0, 1)]);
    },

    basisVector(_dim, axis): Vector2 {
      return axis === 0 ? constVector(1, 0) : constVector(0, 1);
    },

    det(m): NumericHandle {
      const mx = asMatrix(m);
      return derivedNumber(
        world,
        () => mx.cell(0, 0).value * mx.cell(1, 1).value - mx.cell(0, 1).value * mx.cell(1, 0).value,
        '\\det',
      );
    },

    area(p): NumericHandle {
      return p.area;
    },

    eigen(m): Eigen {
      const mx = asMatrix(m);
      const dv = world.derived(() =>
        eigen2x2(mx.cell(0, 0).value, mx.cell(0, 1).value, mx.cell(1, 0).value, mx.cell(1, 1).value),
      );
      const base = world.handle('eigen');
      const vec = (i: 0 | 1): Vector2 => mkVector(() => dv.value.vectors[i].x, () => dv.value.vectors[i].y);
      const v0 = vec(0);
      const v1 = vec(1);
      const values = Object.freeze([
        derivedNumber(world, () => dv.value.values[0], '\\lambda_1'),
        derivedNumber(world, () => dv.value.values[1], '\\lambda_2'),
      ] as const);
      return Object.freeze({
        id: base.id,
        kind: 'eigen' as const,
        get values(): readonly [NumericHandle, NumericHandle] {
          return values;
        },
        get vectors(): readonly [Vector2, Vector2] {
          return [v0, v1];
        },
        get real(): boolean {
          return dv.value.real;
        },
      });
    },

    compose(outer, inner): LinearMap {
      return outer.compose(inner);
    },
  };

  return Object.freeze(lib);
}
