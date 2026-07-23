/**
 * scope.test.ts — the program-scope binding: one factory yields the whole
 * spike authoring surface, bound to one world + stage.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import { createProgramScope, getActiveScope, setActiveScope } from './scope.js';

describe('createProgramScope', () => {
  it('yields the full spike surface bound to one world + stage', () => {
    const world = createWorld();
    const stage = createStage(world);
    const scope = createProgramScope(world, stage);
    expect(scope.world).toBe(world);
    expect(scope.stage).toBe(stage);
    for (const key of ['lesson', 'F', 'M', 'Prob', 'Graph', 'View', 'Layout'] as const) {
      expect(scope[key], key).toBeDefined();
    }
    // M is the reconciled union: automata constructors + slot/range
    expect(typeof scope.M.word).toBe('function');
    expect(typeof scope.M.stateMachine).toBe('function');
    expect(typeof scope.M.slot).toBe('function');
    expect(scope.M.range(4)).toEqual([0, 1, 2, 3]);
  });

  it('rejects a stage from another world', () => {
    const world = createWorld();
    const other = createWorld();
    const stage = createStage(other);
    expect(() => createProgramScope(world, stage)).toThrow(/same world/);
  });

  it('is one-per-world (the lesson layer enforces it)', () => {
    const world = createWorld();
    const stage = createStage(world);
    createProgramScope(world, stage);
    expect(() => createProgramScope(world, stage)).toThrow(/one lesson per world/);
  });

  it('the active-scope registry hands the scope to spike-api shims', () => {
    const world = createWorld();
    const stage = createStage(world);
    const scope = createProgramScope(world, stage);
    setActiveScope(scope);
    expect(getActiveScope()).toBe(scope);
  });

  it('M.derived tracks the parameters it reads', () => {
    const world = createWorld();
    const stage = createStage(world);
    const scope = createProgramScope(world, stage);
    const theta = scope.M.parameter('θ', 0, { range: [0, Math.PI] });
    const dot = scope.M.derived(() => 6 * Math.cos(theta.value), 'dot');

    expect(dot.value).toBeCloseTo(6);
    theta.setValueLive(Math.PI);
    // the point of the whole affordance: no re-read, no rebuild — it follows
    expect(dot.value).toBeCloseTo(-6);
    expect(dot.label).toBe('dot');
  });

  it('M.derived satisfies View.readout, which rejects a dead number', () => {
    const world = createWorld();
    const stage = createStage(world);
    const scope = createProgramScope(world, stage);
    const theta = scope.M.parameter('θ', 1, { range: [0, 2] });

    expect(() => scope.View.readout(scope.M.derived(() => theta.value * 2))).not.toThrow();
    // the trap this exists to close: a snapshot reads as live but never moves
    expect(() => scope.View.readout(theta.value * 2 as never)).toThrow();
  });

  it('a slotted value round-trips through M.slot', () => {
    const world = createWorld();
    const stage = createStage(world);
    const scope = createProgramScope(world, stage);
    const d = scope.Prob.distribution(scope.Prob.states(['A', 'B']), { A: 1 });
    const slot = scope.M.slot(d);
    expect(slot.value).toBe(d);
    const steps = world.timeline.root.length;
    slot.set(d);
    expect(world.timeline.root.length).toBe(steps + 1); // set is a timeline step
  });
});
