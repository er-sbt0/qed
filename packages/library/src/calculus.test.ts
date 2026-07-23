/**
 * calculus.test.ts — the calculus library: quadrature accuracy, the REACTIVE
 * accumulation under a dragged x, the FTC identity (slope of A = f), the thin
 * strip's average rate converging to f(x), and the demonstrate-able Riemann sum.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { World, TraceEvent } from '@math-ai/core';
import { createCalculus, integrate } from './calculus.js';
import type { CalcLib } from './calculus.js';
import { createParameter } from './parameter.js';

function setup(): { world: World; Calc: CalcLib } {
  const world = createWorld();
  return { world, Calc: createCalculus(world) };
}

// f(t) = 0.5t + 1  ⇒  ∫₀ˣ f = 0.25x² + x
const RULE = (t: number): number => 0.5 * t + 1;
const analytic = (x: number): number => 0.25 * x * x + x;

describe('integrate (Simpson)', () => {
  it('matches the analytic integral of a linear rate', () => {
    expect(integrate(RULE, 0, 2)).toBeCloseTo(analytic(2), 9);
    expect(integrate(RULE, 0, 6)).toBeCloseTo(analytic(6), 9);
  });

  it('is signed and zero on a degenerate interval', () => {
    expect(integrate(RULE, 2, 0)).toBeCloseTo(-analytic(2), 9);
    expect(integrate(RULE, 3, 3)).toBe(0);
  });

  it('integrates a curved rate accurately', () => {
    // ∫₀^π sin = 2
    expect(integrate(Math.sin, 0, Math.PI)).toBeCloseTo(2, 6);
  });
});

describe('Fn', () => {
  it('at() reads a number or a NumericHandle uniformly', () => {
    const { world, Calc } = setup();
    const f = Calc.fn(RULE, { label: 'f' });
    expect(f.at(2)).toBe(2);
    const x = createParameter(world, 'x', 3, [0, 6]);
    expect(f.at(x)).toBe(2.5);
    expect(f.label).toBe('f');
  });
});

describe('accumulation — reactive area', () => {
  it('A(x) equals the analytic integral, and re-integrates when x moves', () => {
    const { world, Calc } = setup();
    const f = Calc.fn(RULE);
    const x = createParameter(world, 'x', 2, [0, 6]);
    const A = Calc.accumulation({ rate: f, from: 0, to: x });

    expect(A.value).toBeCloseTo(analytic(2), 6); // 3
    x.setValue(4);
    expect(A.value).toBeCloseTo(analytic(4), 6); // 8
    x.setValue(0);
    expect(A.value).toBeCloseTo(0, 9);
  });

  it('at(upper) is a pure sample (does not disturb the reactive value)', () => {
    const { world, Calc } = setup();
    const A = Calc.accumulation({ rate: Calc.fn(RULE), from: 0, to: createParameter(world, 'x', 2, [0, 6]) });
    expect(A.at(6)).toBeCloseTo(analytic(6), 6);
    expect(A.value).toBeCloseTo(analytic(2), 6); // unchanged
  });

  it('slopeAt(x) is the FTC identity dA/dx = f(x), live', () => {
    const { world, Calc } = setup();
    const f = Calc.fn(RULE);
    const x = createParameter(world, 'x', 2, [0, 6]);
    const A = Calc.accumulation({ rate: f, from: 0, to: x });
    const slope = A.slopeAt(x);
    expect(slope.value).toBeCloseTo(f.at(2), 12); // 2
    x.setValue(5);
    expect(slope.value).toBeCloseTo(f.at(5), 12); // 3.5
  });
});

describe('increment — the thin strip', () => {
  it('average rate ΔA/Δx converges to f(x) as Δx shrinks', () => {
    const { world, Calc } = setup();
    const f = Calc.fn(RULE);
    const x = createParameter(world, 'x', 2, [0, 6]);
    const dx = createParameter(world, '\\Delta x', 0.5, [0.001, 1]);
    const A = Calc.accumulation({ rate: f, from: 0, to: x });
    const strip = Calc.increment({ of: A, at: x, by: dx });

    expect(strip.width.value).toBe(0.5);
    expect(strip.approxHeight.value).toBeCloseTo(f.at(2), 9); // 2
    // for a linear f the midpoint average rate is f(x + Δx/2)
    expect(strip.averageRate.value).toBeCloseTo(f.at(2.25), 6);

    // for linear f the midpoint average rate is f(x + Δx/2), so it → f(x):
    // at Δx=0.5 the gap is ~0.125; at Δx=0.001 it is ~0.00025 — convergent.
    const gapAt = (w: number): number => {
      dx.setValue(w);
      return Math.abs(strip.averageRate.value - f.at(2));
    };
    const wide = gapAt(0.5);
    const narrow = gapAt(0.001);
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBeLessThan(1e-3);
    expect(strip.area.value).toBeGreaterThan(0);
  });
});

describe('riemann — decomposition and demonstrate', () => {
  it('total matches the integral (midpoint rule is exact for linear f)', () => {
    const { Calc } = setup();
    const sum = Calc.riemann({ of: Calc.fn(RULE), from: 0, to: 2, count: 8 });
    expect(sum.rectangles).toHaveLength(8);
    expect(sum.total).toBeCloseTo(analytic(2), 9);
    expect(sum.rectangle(0).area).toBeGreaterThan(0);
    expect(() => sum.rectangle(8)).toThrow(/no rectangle 8/);
  });

  it('finer decomposition converges for a curved rate', () => {
    const { Calc } = setup();
    const coarse = Calc.riemann({ of: Calc.fn(Math.sin), from: 0, to: Math.PI, count: 4 });
    const fine = Calc.riemann({ of: Calc.fn(Math.sin), from: 0, to: Math.PI, count: 64 });
    expect(Math.abs(fine.total - 2)).toBeLessThan(Math.abs(coarse.total - 2));
    expect(fine.total).toBeCloseTo(2, 3);
  });

  it('is demonstrate-able: provenance replays one rectangle event per slice', () => {
    const { world, Calc } = setup();
    const sum = Calc.riemann({ of: Calc.fn(RULE), from: 0, to: 2, count: 5 });
    expect(world.provenanceOf(sum)).toBeTruthy();
    const events: readonly TraceEvent[] = world.trace(sum);
    // the type contains "derive", so the renderer's derive cue un-hides and
    // pulses each rectangle: the slices ink in one at a time under demonstrate
    const rects = events.filter((e) => e.type === 'rectangle:derive');
    expect(rects).toHaveLength(5);
    expect(rects[0]!['index']).toBe(0);
  });

  it('rectangles carry their slice geometry, so the view needs no re-derivation', () => {
    const { Calc } = setup();
    const sum = Calc.riemann({ of: Calc.fn(RULE), from: 0, to: 2, count: 4 });
    expect(sum.rectangle(0).x0).toBeCloseTo(0, 10);
    expect(sum.rectangle(3).x1).toBeCloseTo(2, 10);
    for (const r of sum.rectangles) {
      expect(r.area).toBeCloseTo(r.height * (r.x1 - r.x0), 10);
    }
  });
});
