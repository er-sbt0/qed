/**
 * views.test.ts — guards on the view constructors.
 *
 * A readout tracks a LIVE quantity. Handed a snapshot it used to construct
 * fine and die much later reading `.value` off a number — `undefined.toFixed`,
 * with nothing naming the cause. A generated program hit exactly that.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import { createViews } from './views.js';
import { createCalculus } from './calculus.js';
import { createParameter } from './parameter.js';

function setup() {
  const world = createWorld();
  const { View } = createViews(createStage(world));
  return { world, View, Calc: createCalculus(world) };
}

describe('View.readout', () => {
  it('accepts a live numeric handle', () => {
    const { world, View } = setup();
    const x = createParameter(world, 'x', 2, [0, 6]);
    expect(() => View.readout(x)).not.toThrow();
  });

  it('rejects a plain number, naming the snapshot verbs that produce one', () => {
    const { View, Calc } = setup();
    const f = Calc.fn((t) => 0.5 * t + 1, { label: 'f' });

    // f.at(0) is a number, not a handle — the shape that broke a generated program
    expect(() => View.readout(f.at(0) as never)).toThrow(/LIVE numeric handle.*Fn\.at\(x\)/s);
  });

  it('rejects a dead compareTo as well as a dead quantity', () => {
    const { world, View, Calc } = setup();
    const x = createParameter(world, 'x', 2, [0, 6]);
    const f = Calc.fn((t) => t, { label: 'f' });

    expect(() => View.readout(x, { compareTo: f.at(1) as never })).toThrow(/compareTo/);
  });
});
