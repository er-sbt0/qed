/**
 * parameter.test.ts — M.parameter: the Δ3 interaction-mutable scalar. Clamps to
 * range (the object-boundary policy), and reactive derived numerics that read
 * it recompute when it moves.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createParameter } from './parameter.js';

describe('Parameter', () => {
  it('clamps the initial value into range', () => {
    const world = createWorld();
    const p = createParameter(world, 'x', 99, [0, 6]);
    expect(p.value).toBe(6);
    expect(p.label).toBe('x');
    expect(p.range).toEqual([0, 6]);
    expect(p.kind).toBe('parameter');
  });

  it('clamps setValue to range (invalid states unreachable at the boundary)', () => {
    const world = createWorld();
    const p = createParameter(world, 'x', 2, [0, 6]);
    p.setValue(-3);
    expect(p.value).toBe(0);
    p.setValue(10);
    expect(p.value).toBe(6);
    p.setValue(3.5);
    expect(p.value).toBe(3.5);
  });

  it('is a reactive source: a derived reading .value recomputes on setValue', () => {
    const world = createWorld();
    const p = createParameter(world, 'x', 2, [-10, 10]);
    let evaluations = 0;
    const square = world.derived(() => {
      evaluations += 1;
      return p.value * p.value;
    });
    expect(square.value).toBe(4);
    expect(evaluations).toBe(1);
    p.setValue(3);
    expect(square.value).toBe(9);
    expect(evaluations).toBe(2);
    // idempotent read: no recompute when nothing changed
    expect(square.value).toBe(9);
    expect(evaluations).toBe(2);
  });

  it('names its backing slot by id — the root whyChanged attributes (4c)', () => {
    const world = createWorld();
    const p = createParameter(world, 'x', 2, [1, 5]);
    // the id of a core slot, not the slot itself: the clamp policy stays owned
    const d = world.derived(() => p.value * 2);
    expect(d.dependsOn().map((h) => h.id)).toEqual([p.cellId]);
  });

  it('NaN clamps to the low bound (drag never feeds a derived garbage)', () => {
    const world = createWorld();
    const p = createParameter(world, 'x', 2, [1, 5]);
    p.setValue(NaN);
    expect(p.value).toBe(1);
  });
});
