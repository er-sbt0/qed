/**
 * calculus.ts — the calculus discipline library, in USERLAND over @math-ai/core.
 * Implements spikes/ftc/api.ts's `Calc`:
 *
 *  - `fn(rule)` — a function object whose height rule is an AUTHORED CLOSURE
 *    (decision #2; no CAS, no expression parser). `at(x)` reads a number or a
 *    reactive Parameter uniformly.
 *  - `accumulation({rate, from, to})` — A(x)=∫_from^to rate, a REACTIVE derived
 *    value (Simpson quadrature) that re-integrates when the `to` Parameter
 *    moves: the shaded area and the A-plot follow a dragged x live. Same shape
 *    as `Prob.stationary`. `slopeAt(x)` is dA/dx = rate.at(x) — the FTC
 *    quantity, live.
 *  - `increment({of, at, by})` — the thin strip; every field (width, height,
 *    area, averageRate = ΔA/Δx) is a live scalar so a readout tracks the limit.
 *  - `riemann({of, from, to, count})` — a TRACED operation (so demonstrate can
 *    replay it): emits one `rectangle` trace event per slice, and records
 *    `came-from` provenance, so the rectangles ink in one at a time.
 */

import type { Handle, OpContext, World } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import { constNumber, derivedNumber, numOf } from './numeric.js';
import type { Parameter } from './parameter.js';

// ─────────────────────────────── types ───────────────────────────────

export interface Fn extends Handle<'fn'> {
  readonly label: string;
  readonly rule: (x: number) => number;
  at(x: number | NumericHandle): number;
}

export interface Accumulation extends Handle<'accumulation'> {
  readonly label: string;
  readonly rate: Fn;
  readonly from: number;
  readonly to: Parameter;
  /** The reactive current area at the present value of `to`. */
  readonly value: number;
  /** Area as a function of the upper limit — pure; what View.plot(A) samples. */
  at(upper: number | NumericHandle): number;
  /** dA/dx at x — a live NumericHandle equal to rate.at(x) (the FTC identity). */
  slopeAt(x: Parameter): NumericHandle;
}

export interface Increment extends Handle<'increment'> {
  /** The accumulation this is an increment OF, and where it starts — the
   * geometry the strip view needs (a strip is a rectangle somewhere). */
  readonly of: Accumulation;
  readonly at: Parameter;
  readonly width: NumericHandle;
  readonly approxHeight: NumericHandle;
  readonly area: NumericHandle;
  readonly averageRate: NumericHandle;
}

export interface Rectangle extends Handle<'rectangle'> {
  readonly index: number;
  readonly area: number;
  /** Slice geometry — what the riemann view draws (captured at derive time). */
  readonly x0: number;
  readonly x1: number;
  readonly height: number;
}

export interface RiemannSum extends Handle<'riemann'> {
  readonly rectangles: readonly Rectangle[];
  readonly total: number;
  readonly of: Fn;
  readonly from: number;
  readonly to: number;
  readonly count: number;
  rectangle(index: number): Rectangle;
}

export interface CalcLib {
  fn(rule: (x: number) => number, opts?: { readonly label?: string }): Fn;
  accumulation(opts: {
    readonly rate: Fn;
    readonly from: number;
    readonly to: Parameter;
    readonly label?: string;
  }): Accumulation;
  increment(opts: { readonly of: Accumulation; readonly at: Parameter; readonly by: Parameter }): Increment;
  riemann(opts: {
    readonly of: Fn;
    readonly from: number;
    readonly to: number | Parameter;
    readonly count: number;
  }): RiemannSum;
}

// ───────────────────────────── numerics ─────────────────────────────

/**
 * Composite Simpson's rule for ∫_a^b f. Signed (∫_b^a = −∫_a^b), NaN-safe on a
 * degenerate interval. `SIMPSON_N` even; 512 keeps error well below the 1e-3
 * spot-check tolerances even for the whole domain.
 */
const SIMPSON_N = 512;

export function integrate(rule: (x: number) => number, a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 0;
  const sign = b < a ? -1 : 1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const h = (hi - lo) / SIMPSON_N;
  let sum = rule(lo) + rule(hi);
  for (let i = 1; i < SIMPSON_N; i += 1) {
    sum += (i % 2 === 0 ? 2 : 4) * rule(lo + i * h);
  }
  return (sign * sum * h) / 3;
}

// ───────────────────────────── factory ─────────────────────────────

export function createCalculus(world: World): CalcLib {
  const riemannOp = world.defineOp(
    'Calc.riemann',
    (ctx: OpContext, f: Fn, from: number, to: number, count: number): RiemannSum => {
      const n = Math.max(1, Math.floor(count));
      const dx = (to - from) / n;
      const rects: Rectangle[] = [];
      let total = 0;
      for (let i = 0; i < n; i += 1) {
        const x0 = from + i * dx;
        const mid = from + (i + 0.5) * dx; // midpoint rule
        const height = f.rule(mid);
        const areaR = height * dx;
        total += areaR;
        const rect = ctx.value('rectangle', {
          index: i,
          area: areaR,
          x0,
          x1: x0 + dx,
          height,
        }) as Rectangle;
        // one trace event per slice. The type contains "derive", so the
        // renderer's derive cue un-hides and pulses the rectangle: under
        // `demonstrate(sum)` the slices ink in one at a time.
        ctx.trace({ type: 'rectangle:derive', subject: rect, index: i, area: areaR });
        rects.push(rect);
      }
      return ctx.value('riemann', {
        rectangles: Object.freeze([...rects]),
        total,
        of: f,
        from,
        to,
        count: n,
        rectangle: (index: number): Rectangle => {
          const r = rects[index];
          if (!r) throw new Error(`riemann sum has no rectangle ${index} (of ${rects.length})`);
          return r;
        },
      }) as RiemannSum;
    },
  );

  const lib: CalcLib = {
    fn(rule, opts): Fn {
      const base = world.handle('fn');
      return Object.freeze({
        id: base.id,
        kind: 'fn' as const,
        label: opts?.label ?? 'f',
        rule,
        at: (x: number | NumericHandle): number => rule(numOf(x)),
      });
    },

    accumulation(opts): Accumulation {
      const { rate, from, to } = opts;
      // REACTIVE: reads `to.value` (tracked), re-integrates when x moves.
      const areaDerived = world.derived(() => integrate(rate.rule, from, to.value));
      const base = world.handle('accumulation');
      return Object.freeze({
        id: base.id,
        kind: 'accumulation' as const,
        label: opts.label ?? 'A(x)',
        rate,
        from,
        to,
        get value(): number {
          return areaDerived.value;
        },
        at: (upper: number | NumericHandle): number => integrate(rate.rule, from, numOf(upper)),
        slopeAt: (x: Parameter): NumericHandle =>
          derivedNumber(world, () => rate.rule(x.value), `${rate.label}(${x.label})`),
      });
    },

    increment(opts): Increment {
      const { of: acc, at: x, by: dx } = opts;
      const base = world.handle('increment');
      const width = derivedNumber(world, () => dx.value, dx.label);
      const approxHeight = derivedNumber(world, () => acc.rate.rule(x.value), 'f(x)');
      const area = derivedNumber(world, () => acc.at(x.value + dx.value) - acc.at(x.value), '\\Delta A');
      const averageRate = derivedNumber(world, () => {
        const w = dx.value;
        return w === 0 ? acc.rate.rule(x.value) : (acc.at(x.value + w) - acc.at(x.value)) / w;
      }, '\\Delta A/\\Delta x');
      return Object.freeze({
        id: base.id,
        kind: 'increment' as const,
        of: acc,
        at: x,
        width,
        approxHeight,
        area,
        averageRate,
      });
    },

    riemann(opts): RiemannSum {
      // capture-at-derive: `to` may be a Parameter; snapshot it now (so the
      // sum is demonstrate-able) — the same policy Prob.step uses for the matrix.
      return riemannOp(opts.of, opts.from, numOf(opts.to), opts.count);
    },
  };

  return Object.freeze(lib);
}

/** Re-exported for tests: a fixed scalar (used when a literal height is wanted). */
export { constNumber };
