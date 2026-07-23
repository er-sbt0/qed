/**
 * field.ts — vector and scalar fields over the plane (roadmap step 2a).
 *
 * A field is a rule indexed over a domain, and the rule is an AUTHORED
 * CLOSURE: `Field.vectorField((x, y) => [-y, x])`. That is the same division
 * of labour as `Calc.fn` — the model supplies the mathematics, the engine
 * supplies structure, identity and display. There is no expression parser and
 * no CAS here either.
 *
 * Two things make this more than `Calc.fn` with an extra argument:
 *
 *  - **Derived fields.** `Field.curl(F)` is a field defined by a numerical
 *    operation on another field, evaluated lazily per sample point. The engine
 *    already leans on numerics of exactly this weight (`Calc.accumulation` is
 *    Simpson quadrature), so a central difference is in keeping: it is
 *    approximation, not symbolic manipulation.
 *  - **Liveness through the rule.** A Parameter read INSIDE the closure makes
 *    the whole field reactive for free — every view re-samples on repaint, so
 *    dragging the parameter redraws every arrow with no per-sample wiring.
 *    `curlAt`/`valueAt` are the O(1) live scalars a readout or a claim can
 *    watch; the views re-run the rule per sample and pay grid² per frame.
 *
 * On the space a field lives over: the probe's ledger (docs/probe-vector.md)
 * asked for exactly ONE thing here and it is now built — a `PlaneRegion` owns
 * its `domain`, and views borrow it with `{ over: region }` instead of each
 * restating an extent that can silently disagree with the geometry. The full
 * `Space` noun `docs/vision.md` sketches — metric, measure, products, charts —
 * has no evidence behind it and is deliberately NOT here (roadmap step 3).
 */

import type { Handle, World } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import { derivedNumber, numOf } from './numeric.js';
import type { LabeledNumber } from './numeric.js';
import { live, vec2Equals, vec2ListEquals } from './live.js';
import type { Live } from './live.js';
import { matrix2 } from './linalg.js';
import type { Matrix2 } from './linalg.js';

export type Vec2 = readonly [number, number];

/**
 * The step for every finite difference in this file. Small enough to be
 * accurate on the smooth fields lessons use, large enough that float
 * cancellation does not eat the answer — the usual ~cbrt(eps) territory for a
 * central difference.
 */
const H = 1e-4;

export interface VectorField extends Handle<'vectorField'> {
  readonly label: string;
  readonly rule: (x: number, y: number) => Vec2;
  /** Snapshot: the vector at a point. Reads handles so it is tracked inside a derived. */
  at(x: number | NumericHandle, y: number | NumericHandle): Vec2;
  /** Live: the scalar curl ∂Q/∂x − ∂P/∂y at a (possibly moving) point. */
  curlAt(x: number | NumericHandle, y: number | NumericHandle): LabeledNumber;
  /** Live: |F| at a point. */
  magnitudeAt(x: number | NumericHandle, y: number | NumericHandle): LabeledNumber;
}

export interface ScalarField extends Handle<'scalarField'> {
  readonly label: string;
  readonly rule: (x: number, y: number) => number;
  at(x: number | NumericHandle, y: number | NumericHandle): number;
  /** Live: the value at a (possibly moving) point. */
  valueAt(x: number | NumericHandle, y: number | NumericHandle): LabeledNumber;
}

/**
 * One directed edge of a loop. Endpoints are CLOSURES, so a segment follows a
 * moving vertex, and `reversed()` returns the same segment by IDENTITY with
 * its traversal flipped — the same geometric edge, walked the other way.
 *
 * That identity is the whole point, and it is what the cancellation beat of
 * Green's theorem needs: when two adjacent tiles meet along an edge, they must
 * be holding the SAME handle with opposite orientation, so focusing it shows
 * two contributions that sum to zero. Hand-linking O(n²) correspondences
 * instead would not survive authoring.
 */
export interface Segment extends Handle<'segment'> {
  readonly index: number;
  /** −1 when this is the reversed traversal of the underlying edge. */
  readonly orientation: 1 | -1;
  from(): Vec2;
  to(): Vec2;
  midpoint(): Vec2;
  /** to − from. */
  delta(): Vec2;
  /**
   * The endpoints as ONE live value, memoized and equality-guarded.
   *
   * The four calls above read this; they are kept because a program says
   * `seg.midpoint()` far more naturally than `seg.path.value`. What changed in
   * step 3 is what is underneath: these used to be plain closures re-run on
   * every read, with no memoization and nothing for a view to subscribe to.
   */
  readonly path: Live<readonly [Vec2, Vec2]>;
  /** The same edge (same id) walked the other way. */
  reversed(): Segment;
}

/**
 * A closed, oriented chain of segments. The SIGN of `area` is the orientation
 * — the same doctrine `LinAlg.Polygon.area` already follows, rather than a
 * separate orientation flag that could disagree with the geometry.
 */
export interface OrientedLoop extends Handle<'loop'> {
  readonly label: string;
  readonly segments: readonly Segment[];
  points(): readonly Vec2[];
  /** The vertices as one live value — `points()` reads it. */
  readonly path: Live<readonly Vec2[]>;
  /** Live SIGNED area enclosed; positive counterclockwise. */
  readonly area: LabeledNumber;
  /** The same loop walked the other way — every contribution negates. */
  reversed(): OrientedLoop;
}

/** A patch of the plane that hands out its boundary BY CONSTRUCTION. */
export interface PlaneRegion extends Handle<'planeRegion'> {
  readonly label: string;
  readonly area: LabeledNumber;
  /** Live [minCorner, maxCorner] — what a tiling subdivides. */
  bounds(): readonly [Vec2, Vec2];
  /**
   * The region's own extent, live — the ONE piece of `Space` the Green ledger
   * actually asked for (roadmap step 3: no metric, no measure, no charts).
   * Views borrow it (`View.field(F, { over: omega })`) instead of each
   * re-declaring a domain that can silently disagree with the geometry.
   */
  readonly domain: Live<readonly [Vec2, Vec2]>;
  /**
   * ∂Ω, minted with the region and linked to it. The program never builds the
   * boundary separately, so the two cannot drift out of correspondence.
   */
  readonly boundary: OrientedLoop;
}

/** One segment's share of a circulation — the traced op's per-step value. */
export interface Contribution extends Handle<'contribution'> {
  readonly index: number;
  readonly segment: Segment;
  readonly amount: number;
}

/** The traced walk `demonstrate` replays, inking one edge's F·dr at a time. */
export interface CirculationWalk extends Handle<'circulationWalk'> {
  readonly of: VectorField;
  readonly loop: OrientedLoop;
  readonly contributions: readonly Contribution[];
  readonly total: number;
}

/**
 * The curl probe: a shrinking loop at a point, its circulation, and the ratio
 * that converges to curl. Deliberately the exact shape of `Calc.Increment`
 * (a width, a raw quantity, and their live ratio) — the limit idiom already
 * works and this reuses it rather than inventing a second one.
 */
export interface CirculationDensity extends Handle<'circulationDensity'> {
  readonly loop: OrientedLoop;
  /** Live: the loop's radius (the thing to shrink). */
  readonly radius: NumericHandle;
  /** Live: ∮F·dr around the probe loop. */
  readonly circulation: LabeledNumber;
  /** Live: the enclosed area. */
  readonly area: LabeledNumber;
  /** Live: circulation / area — this is what converges. */
  readonly density: LabeledNumber;
  /** Live: the curl at the center — what it converges TO. */
  readonly curl: LabeledNumber;
}

/** One cell of a tiling. Its boundary segments are SHARED with its neighbours. */
export interface Tile extends Handle<'tile'> {
  readonly row: number;
  readonly col: number;
  readonly boundary: OrientedLoop;
  readonly area: LabeledNumber;
}

/**
 * A region cut into cells, Riemann-style — and the crown jewel of the probe.
 *
 * The non-negotiable design point: two adjacent cells' shared edge IS one
 * segment handle, held by one cell forward and by the other reversed. That is
 * what makes the cancellation beat authorable at all. Focus a shared edge and
 * the two contributions visibly sum to zero; focus the boundary edges and they
 * are exactly what does NOT cancel — which is Green's theorem, shown rather
 * than asserted. Without by-construction sharing a program would have to
 * hand-link O(n²) correspondences and the beat would die on authoring cost.
 */
export interface Tiling extends Handle<'tiling'> {
  readonly of: PlaneRegion;
  readonly n: number;
  readonly tiles: readonly Tile[];
  /** Shared by two cells — these are the ones that cancel. */
  readonly interiorEdges: readonly Segment[];
  /** Held by one cell only — these survive, and they are ∂Ω. */
  readonly boundaryEdges: readonly Segment[];
  tile(row: number, col: number): Tile;
}

/** One cell's share of the total circulation — the traced tiling's step value. */
export interface TileCirculation extends Handle<'tileCirculation'> {
  readonly index: number;
  readonly tile: Tile;
  readonly amount: number;
}

/** The traced sweep `demonstrate` replays, inking cells one at a time. */
export interface TilingWalk extends Handle<'tilingWalk'> {
  readonly of: VectorField;
  readonly tiling: Tiling;
  readonly cells: readonly TileCirculation[];
  readonly total: number;
}

export interface FieldLib {
  /** A vector field from an authored closure: `(x, y) => [P, Q]`. */
  vectorField(rule: (x: number, y: number) => Vec2, opts?: { readonly label?: string }): VectorField;
  /** A scalar field from an authored closure. */
  scalarField(rule: (x: number, y: number) => number, opts?: { readonly label?: string }): ScalarField;
  /**
   * The scalar curl of a plane field: ∂Q/∂x − ∂P/∂y, by central difference.
   * This is the "microscopic circulation" side of Green's theorem, and it is a
   * FIELD — so `View.heatmap(Field.curl(F))` shows where the swirl lives.
   */
  curl(F: VectorField, opts?: { readonly label?: string }): ScalarField;
  /** ∂P/∂x + ∂Q/∂y — the flux twin of curl, same machinery. */
  divergence(F: VectorField, opts?: { readonly label?: string }): ScalarField;

  // ── the differential half (step 2.5) ──

  /**
   * ∇f as a VECTOR FIELD, by central difference. `View.field(Field.gradient(f))`
   * is the arrow picture of steepest ascent; `Field.gradient(f).magnitudeAt(x, y)`
   * is the live |∇f| a critical-point claim tests against zero.
   */
  gradient(f: ScalarField, opts?: { readonly label?: string }): VectorField;
  /**
   * The Hessian of f AT a point, as a real `LinAlg.matrix` whose four entries
   * are live derived numbers — so `LinAlg.eigen(Field.hessian(f, [a, b]))`
   * gives the second derivative test with no further engine work, and the
   * point may be a pair of draggable Parameters.
   */
  hessian(
    f: ScalarField,
    at: readonly [number | NumericHandle, number | NumericHandle],
  ): Matrix2;

  // ── loops, regions, circulation (step 2b) ──

  /** A closed loop through live vertices. The closure may read Parameters. */
  loop(opts: { readonly points: () => readonly Vec2[]; readonly label?: string }): OrientedLoop;
  /** An axis-aligned rectangular loop; any corner may be a live handle. */
  rectangleLoop(opts: {
    readonly x0: number | NumericHandle;
    readonly y0: number | NumericHandle;
    readonly x1: number | NumericHandle;
    readonly y1: number | NumericHandle;
    readonly label?: string;
  }): OrientedLoop;
  /** A circular loop, polygonized. `radius` is usually the thing to shrink. */
  circleLoop(opts: {
    readonly center: readonly [number | NumericHandle, number | NumericHandle];
    readonly radius: number | NumericHandle;
    readonly steps?: number;
    readonly label?: string;
  }): OrientedLoop;
  /** A rectangular region that hands out its own boundary. */
  rectangle(opts: {
    readonly x0: number | NumericHandle;
    readonly y0: number | NumericHandle;
    readonly x1: number | NumericHandle;
    readonly y1: number | NumericHandle;
    readonly label?: string;
  }): PlaneRegion;
  /**
   * REACTIVE stance: ∮F·dr as a live scalar, so it follows a drag. Pair with
   * `walk` when the point is the choreography instead of the number.
   */
  circulation(F: VectorField, loop: OrientedLoop, opts?: { readonly label?: string }): LabeledNumber;
  /** Live: this one segment's F·dr — what a cancellation beat focuses. */
  contribution(F: VectorField, segment: Segment): LabeledNumber;
  /**
   * TRACED stance: one event per segment, so `lesson.demonstrate(walk)` inks
   * the contributions in one at a time. Snapshot by construction, like every
   * traced op — see the two-stance doctrine in docs/architecture.md.
   */
  walk(F: VectorField, loop: OrientedLoop): CirculationWalk;
  /**
   * Cut a region into n×n cells whose shared edges are the SAME segment
   * handles (step 2d). This is what the cancellation beat is built on.
   */
  tile(region: PlaneRegion, opts: { readonly n: number }): Tiling;
  /**
   * TRACED: one event per cell, so `demonstrate` inks each cell's tiny
   * circulation in turn and the interior visibly cancels away.
   */
  walkTiles(F: VectorField, tiling: Tiling): TilingWalk;
  /** The curl probe (step 2c): shrink `radius` and watch density meet curl. */
  circulationDensity(
    F: VectorField,
    opts: {
      readonly at: readonly [number | NumericHandle, number | NumericHandle];
      readonly radius: NumericHandle;
      readonly steps?: number;
    },
  ): CirculationDensity;
}

/** ∂Q/∂x − ∂P/∂y by central difference. */
function curlOf(rule: (x: number, y: number) => Vec2, x: number, y: number): number {
  const dQdx = (rule(x + H, y)[1] - rule(x - H, y)[1]) / (2 * H);
  const dPdy = (rule(x, y + H)[0] - rule(x, y - H)[0]) / (2 * H);
  return dQdx - dPdy;
}

/** ∂P/∂x + ∂Q/∂y by central difference. */
function divergenceOf(rule: (x: number, y: number) => Vec2, x: number, y: number): number {
  const dPdx = (rule(x + H, y)[0] - rule(x - H, y)[0]) / (2 * H);
  const dQdy = (rule(x, y + H)[1] - rule(x, y - H)[1]) / (2 * H);
  return dPdx + dQdy;
}

/** ∇f by central difference. */
function gradientOf(rule: (x: number, y: number) => number, x: number, y: number): Vec2 {
  return [
    (rule(x + H, y) - rule(x - H, y)) / (2 * H),
    (rule(x, y + H) - rule(x, y - H)) / (2 * H),
  ];
}

/**
 * Second partials by central difference, at H — the same step as everything
 * else here. That is not a coincidence to tidy up: h ≈ eps^(1/4) is the
 * optimum for a second difference (roundoff eps/h² against truncation h²),
 * and 1e-4 is right on it, so second derivatives land near 1e-7 absolute.
 */
function secondPartialsOf(
  rule: (x: number, y: number) => number,
  x: number,
  y: number,
): { fxx: number; fyy: number; fxy: number } {
  const c = rule(x, y);
  return {
    fxx: (rule(x + H, y) - 2 * c + rule(x - H, y)) / (H * H),
    fyy: (rule(x, y + H) - 2 * c + rule(x, y - H)) / (H * H),
    fxy:
      (rule(x + H, y + H) - rule(x + H, y - H) - rule(x - H, y + H) + rule(x - H, y - H)) /
      (4 * H * H),
  };
}

/** Shoelace — signed, so the sign carries the orientation. */
function shoelace(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export function createFieldLib(world: World): FieldLib {
  const scalarField = (
    rule: (x: number, y: number) => number,
    opts?: { readonly label?: string },
  ): ScalarField => {
    const base = world.handle('scalarField');
    const label = opts?.label ?? 'g';
    const at = (x: number | NumericHandle, y: number | NumericHandle): number =>
      rule(numOf(x), numOf(y));
    return Object.freeze({
      id: base.id,
      kind: 'scalarField' as const,
      label,
      rule,
      at,
      valueAt: (x: number | NumericHandle, y: number | NumericHandle): LabeledNumber =>
        derivedNumber(world, () => at(x, y), `${label}(x,y)`),
    });
  };

  /**
   * A segment and its reverse share ONE id. `reversed()` is memoized both
   * ways so `seg.reversed().reversed() === seg`, which keeps a loop and its
   * reversal pointing at the same edges rather than at copies.
   */
  const makeSegment = (
    index: number,
    from: () => Vec2,
    to: () => Vec2,
    id?: string,
  ): Segment => {
    const base = id ?? world.handle('segment').id;
    const build = (
      a: () => Vec2,
      b: () => Vec2,
      orientation: 1 | -1,
      other: () => Segment,
    ): Segment => {
      // ONE live cell behind all four readers. Equality is elementwise, so a
      // drag that leaves this edge where it was does not invalidate the
      // contribution derived from it — the memoization step 3 bought.
      const path = live<readonly [Vec2, Vec2]>(world, () => [a(), b()], {
        kind: 'segmentPath',
        equals: (p, q) => vec2Equals(p[0], q[0]) && vec2Equals(p[1], q[1]),
      });
      return Object.freeze({
        id: base,
        kind: 'segment' as const,
        index,
        orientation,
        path,
        from: (): Vec2 => path.value[0],
        to: (): Vec2 => path.value[1],
        midpoint: (): Vec2 => {
          const [p, q] = path.value;
          return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        },
        delta: (): Vec2 => {
          const [p, q] = path.value;
          return [q[0] - p[0], q[1] - p[1]];
        },
        reversed: other,
      });
    };
    // The two traversals are built as a mutually-referencing pair, so
    // `seg.reversed().reversed() === seg` — an involution, not a copy chain.
    const forward: Segment = build(from, to, 1, () => backward);
    const backward: Segment = build(to, from, -1, () => forward);
    return forward;
  };

  const makeLoop = (
    rawPoints: () => readonly Vec2[],
    label: string,
    segments?: readonly Segment[],
  ): OrientedLoop => {
    const base = world.handle('loop');
    const path = live<readonly Vec2[]>(world, rawPoints, {
      kind: 'loopPath',
      equals: vec2ListEquals,
    });
    const points = (): readonly Vec2[] => path.value;
    const n = points().length;
    const segs =
      segments ??
      Array.from({ length: n }, (_, i) =>
        makeSegment(
          i,
          () => points()[i]!,
          () => points()[(i + 1) % n]!,
        ),
      );
    const area = derivedNumber(world, () => shoelace(points()), `\\text{area}(${label})`);
    let flipped: OrientedLoop | null = null;
    const self: OrientedLoop = Object.freeze({
      id: base.id,
      kind: 'loop' as const,
      label,
      segments: Object.freeze([...segs]),
      points,
      path,
      area,
      reversed: (): OrientedLoop => {
        if (!flipped) {
          // same segment ids, opposite traversal, reversed visiting order
          const back = [...segs].reverse().map((s) => s.reversed());
          flipped = makeLoop(() => [...points()].reverse(), `${label}^{-}`, back);
        }
        return flipped;
      },
    });
    return self;
  };

  const contribution = (F: VectorField, segment: Segment): LabeledNumber =>
    derivedNumber(
      world,
      () => {
        const [mx, my] = segment.midpoint();
        const [dx, dy] = segment.delta();
        const [p, q] = F.rule(mx, my);
        return p * dx + q * dy;
      },
      `${F.label}\\cdot d\\mathbf{r}`,
    );

  const circulationOf = (F: VectorField, loop: OrientedLoop): number => {
    let total = 0;
    for (const seg of loop.segments) {
      const [mx, my] = seg.midpoint();
      const [dx, dy] = seg.delta();
      const [p, q] = F.rule(mx, my);
      total += p * dx + q * dy;
    }
    return total;
  };

  const walkOp = world.defineOp(
    'Field.walk',
    (ctx, F: VectorField, loop: OrientedLoop): CirculationWalk => {
      const contributions: Contribution[] = [];
      let total = 0;
      loop.segments.forEach((segment, index) => {
        const [mx, my] = segment.midpoint();
        const [dx, dy] = segment.delta();
        const [p, q] = F.rule(mx, my);
        const amount = p * dx + q * dy;
        total += amount;
        const value = ctx.value('contribution', { index, segment, amount }) as Contribution;
        // "derive" in the type is what the renderer's derive cue keys on, so
        // demonstrate inks one edge's contribution at a time — same mechanism
        // that makes Riemann rectangles appear one by one.
        ctx.trace({ type: 'contribution:derive', subject: value, index, amount });
        ctx.link(value, segment, 'contributes-to');
        contributions.push(value);
      });
      return ctx.value('circulationWalk', {
        of: F,
        loop,
        contributions: Object.freeze([...contributions]),
        total,
      }) as CirculationWalk;
    },
  );

  const walkTilesOp = world.defineOp(
    'Field.walkTiles',
    (ctx, F: VectorField, tiling: Tiling): TilingWalk => {
      const cells: TileCirculation[] = [];
      let total = 0;
      tiling.tiles.forEach((tile, index) => {
        const amount = circulationOf(F, tile.boundary);
        total += amount;
        const value = ctx.value('tileCirculation', { index, tile, amount }) as TileCirculation;
        ctx.trace({ type: 'tile:derive', subject: value, index, amount });
        ctx.link(value, tile, 'contributes-to');
        cells.push(value);
      });
      return ctx.value('tilingWalk', {
        of: F,
        tiling,
        cells: Object.freeze([...cells]),
        total,
      }) as TilingWalk;
    },
  );

  const lib: FieldLib = {
    vectorField(rule, opts): VectorField {
      const base = world.handle('vectorField');
      const label = opts?.label ?? 'F';
      const at = (x: number | NumericHandle, y: number | NumericHandle): Vec2 =>
        rule(numOf(x), numOf(y));
      return Object.freeze({
        id: base.id,
        kind: 'vectorField' as const,
        label,
        rule,
        at,
        curlAt: (x: number | NumericHandle, y: number | NumericHandle): LabeledNumber =>
          derivedNumber(world, () => curlOf(rule, numOf(x), numOf(y)), `\\text{curl}\\,${label}`),
        magnitudeAt: (x: number | NumericHandle, y: number | NumericHandle): LabeledNumber =>
          derivedNumber(
            world,
            () => {
              const [u, v] = at(x, y);
              return Math.hypot(u, v);
            },
            `|${label}|`,
          ),
      });
    },

    scalarField,

    curl(F, opts): ScalarField {
      return scalarField((x, y) => curlOf(F.rule, x, y), {
        label: opts?.label ?? `\\text{curl}\\,${F.label}`,
      });
    },

    divergence(F, opts): ScalarField {
      return scalarField((x, y) => divergenceOf(F.rule, x, y), {
        label: opts?.label ?? `\\text{div}\\,${F.label}`,
      });
    },

    gradient(f, opts): VectorField {
      return lib.vectorField((x, y) => gradientOf(f.rule, x, y), {
        label: opts?.label ?? `\\nabla ${f.label}`,
      });
    },

    hessian(f, at): Matrix2 {
      // One derived per entry, each re-running the whole stencil. That is four
      // times the arithmetic of a single shared cell, and it is the right
      // trade: the entries must be independent NumericHandles for
      // LinAlg.matrix, and the stencil is nine cheap closure calls.
      const entry = (pick: (p: { fxx: number; fyy: number; fxy: number }) => number, label: string) =>
        derivedNumber(
          world,
          () => pick(secondPartialsOf(f.rule, numOf(at[0]), numOf(at[1]))),
          label,
        );
      const fxy = entry((p) => p.fxy, `${f.label}_{xy}`);
      return matrix2(world, [
        [entry((p) => p.fxx, `${f.label}_{xx}`), fxy],
        // symmetric BY CONSTRUCTION: the same handle in both off-diagonal
        // slots, so eigen never sees a Hessian that drifted asymmetric from
        // finite-difference noise.
        [fxy, entry((p) => p.fyy, `${f.label}_{yy}`)],
      ]);
    },

    loop(opts): OrientedLoop {
      const first = opts.points();
      if (first.length < 3) {
        throw new Error(
          `Field.loop needs at least 3 points to enclose anything — got ${first.length}.`,
        );
      }
      return makeLoop(opts.points, opts.label ?? 'C');
    },

    rectangleLoop(opts): OrientedLoop {
      // counterclockwise, so the enclosed area comes out positive
      return makeLoop(
        () => [
          [numOf(opts.x0), numOf(opts.y0)],
          [numOf(opts.x1), numOf(opts.y0)],
          [numOf(opts.x1), numOf(opts.y1)],
          [numOf(opts.x0), numOf(opts.y1)],
        ],
        opts.label ?? 'C',
      );
    },

    circleLoop(opts): OrientedLoop {
      const steps = Math.max(3, Math.floor(opts.steps ?? 48));
      return makeLoop(
        () => {
          const cx = numOf(opts.center[0]);
          const cy = numOf(opts.center[1]);
          const r = numOf(opts.radius);
          return Array.from({ length: steps }, (_, i): Vec2 => {
            const t = (2 * Math.PI * i) / steps;
            return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
          });
        },
        opts.label ?? 'C',
      );
    },

    rectangle(opts): PlaneRegion {
      const base = world.handle('planeRegion');
      const label = opts.label ?? '\\Omega';
      const boundary = lib.rectangleLoop({ ...opts, label: `\\partial ${label}` });
      const domain = live<readonly [Vec2, Vec2]>(
        world,
        () => {
          const ax = numOf(opts.x0);
          const ay = numOf(opts.y0);
          const bx = numOf(opts.x1);
          const by = numOf(opts.y1);
          return [
            [Math.min(ax, bx), Math.min(ay, by)],
            [Math.max(ax, bx), Math.max(ay, by)],
          ];
        },
        {
          kind: 'domain',
          equals: (p, q) => vec2Equals(p[0], q[0]) && vec2Equals(p[1], q[1]),
        },
      );
      const region: PlaneRegion = Object.freeze({
        id: base.id,
        kind: 'planeRegion' as const,
        label,
        domain,
        bounds: (): readonly [Vec2, Vec2] => domain.value,
        area: derivedNumber(
          world,
          () => Math.abs((numOf(opts.x1) - numOf(opts.x0)) * (numOf(opts.y1) - numOf(opts.y0))),
          `\\text{area}(${label})`,
        ),
        boundary,
      });
      // ∂Ω corresponds to Ω BY CONSTRUCTION — the program never links these
      // by hand, so they cannot be linked wrongly or forgotten.
      world.link(boundary, region, 'counterpart-of');
      return region;
    },

    circulation(F, loop, opts): LabeledNumber {
      return derivedNumber(
        world,
        () => circulationOf(F, loop),
        opts?.label ?? `\\oint_{${loop.label}} ${F.label}\\cdot d\\mathbf{r}`,
      );
    },

    contribution,

    walk(F, loop): CirculationWalk {
      return walkOp(F, loop);
    },

    tile(region, opts): Tiling {
      const n = Math.max(1, Math.floor(opts.n));
      const base = world.handle('tiling');
      // Live lattice coordinate: the tiling follows a region whose corners move.
      const gx = (i: number): number => {
        const [lo, hi] = region.bounds();
        return lo[0] + ((hi[0] - lo[0]) * i) / n;
      };
      const gy = (j: number): number => {
        const [lo, hi] = region.bounds();
        return lo[1] + ((hi[1] - lo[1]) * j) / n;
      };

      // Every horizontal and vertical edge of the lattice is minted ONCE.
      // Cells then pick edges out of these tables — which is the entire trick:
      // sharing is a consequence of construction, not of a later linking pass.
      const horizontal: Segment[][] = Array.from({ length: n + 1 }, (_, j) =>
        Array.from({ length: n }, (_, i) =>
          makeSegment(
            j * n + i,
            () => [gx(i), gy(j)],
            () => [gx(i + 1), gy(j)],
          ),
        ),
      );
      const vertical: Segment[][] = Array.from({ length: n }, (_, j) =>
        Array.from({ length: n + 1 }, (_, i) =>
          makeSegment(
            j * (n + 1) + i,
            () => [gx(i), gy(j)],
            () => [gx(i), gy(j + 1)],
          ),
        ),
      );

      const tiles: Tile[] = [];
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          // counterclockwise: bottom → right → top(reversed) → left(reversed)
          const segs = [
            horizontal[j]![i]!,
            vertical[j]![i + 1]!,
            horizontal[j + 1]![i]!.reversed(),
            vertical[j]![i]!.reversed(),
          ];
          const points = (): readonly Vec2[] => [
            [gx(i), gy(j)],
            [gx(i + 1), gy(j)],
            [gx(i + 1), gy(j + 1)],
            [gx(i), gy(j + 1)],
          ];
          const boundary = makeLoop(points, `\\partial c_{${j},${i}}`, segs);
          const cell = world.handle('tile');
          const tile: Tile = Object.freeze({
            id: cell.id,
            kind: 'tile' as const,
            row: j,
            col: i,
            boundary,
            area: derivedNumber(world, () => shoelace(points()), 'cell area'),
          });
          world.link(boundary, tile, 'counterpart-of');
          tiles.push(tile);
        }
      }

      // Interior vs boundary is READ OFF the lattice, not asserted: an edge is
      // interior exactly when it has a cell on both sides.
      const interiorEdges: Segment[] = [];
      const boundaryEdges: Segment[] = [];
      horizontal.forEach((row, j) => {
        row.forEach((seg) => (j === 0 || j === n ? boundaryEdges : interiorEdges).push(seg));
      });
      vertical.forEach((row) => {
        row.forEach((seg, i) => (i === 0 || i === n ? boundaryEdges : interiorEdges).push(seg));
      });

      return Object.freeze({
        id: base.id,
        kind: 'tiling' as const,
        of: region,
        n,
        tiles: Object.freeze([...tiles]),
        interiorEdges: Object.freeze([...interiorEdges]),
        boundaryEdges: Object.freeze([...boundaryEdges]),
        tile: (row: number, col: number): Tile => {
          const t = tiles[row * n + col];
          if (!t) throw new Error(`tiling has no cell (${row}, ${col}) — it is ${n}x${n}`);
          return t;
        },
      });
    },

    walkTiles(F, tiling): TilingWalk {
      return walkTilesOp(F, tiling);
    },

    circulationDensity(F, opts): CirculationDensity {
      const base = world.handle('circulationDensity');
      const loop = lib.circleLoop({
        center: opts.at,
        radius: opts.radius,
        steps: opts.steps ?? 48,
        label: 'C_r',
      });
      const circulation = lib.circulation(F, loop);
      const area = loop.area;
      const curl = F.curlAt(opts.at[0], opts.at[1]);
      // At radius 0 the ratio is 0/0. Fall back to the limit itself, exactly
      // as Calc.increment's averageRate falls back to the rate at width 0 —
      // the readout then shows the value it converged to rather than NaN.
      const density = derivedNumber(
        world,
        () => {
          const a = area.value;
          return Math.abs(a) < 1e-12 ? curl.value : circulation.value / a;
        },
        '\\oint/\\text{area}',
      );
      return Object.freeze({
        id: base.id,
        kind: 'circulationDensity' as const,
        loop,
        radius: opts.radius,
        circulation,
        area,
        density,
        curl,
      });
    },
  };
  return Object.freeze(lib);
}
