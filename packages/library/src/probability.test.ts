/**
 * probability.test.ts — the probability library: the renormalize-row
 * interaction policy, parcel-traced steps, REACTIVE stationary under cell
 * edits, and seeded, replayable walks.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { World } from '@math-ai/core';
import { createProbability } from './probability.js';
import type { Distribution, ProbLib } from './probability.js';

function setup(): { world: World; Prob: ProbLib } {
  const world = createWorld();
  return { world, Prob: createProbability(world) };
}

function threeState(Prob: ProbLib, editable?: 'renormalize-row' | 'locked') {
  const states = Prob.states(['Sunny', 'Cloudy', 'Rainy']);
  const P = Prob.stochasticMatrix({
    states,
    values: [
      [0.7, 0.2, 0.1],
      [0.3, 0.4, 0.3],
      [0.2, 0.3, 0.5],
    ],
    editable,
  });
  return { states, P };
}

describe('states', () => {
  it('mints labeled state handles and looks them up', () => {
    const { Prob } = setup();
    const states = Prob.states(['A', 'B']);
    expect(states.items.map((s) => s.label)).toEqual(['A', 'B']);
    expect(states.state('B').kind).toBe('state');
    expect(() => states.state('C')).toThrow(/no state labeled "C"/);
  });
});

describe('stochasticMatrix — the renormalize-row policy', () => {
  it('rejects a grid that does not match the states', () => {
    const { Prob } = setup();
    const states = Prob.states(['A', 'B']);
    expect(() => Prob.stochasticMatrix({ states, values: [[1]] })).toThrow(/2×2/);
  });

  it('a cell edit renormalizes its row, preserving the others’ proportions', () => {
    const { Prob } = setup();
    const { P } = threeState(Prob, 'renormalize-row');
    P.cell('Sunny', 'Sunny').setValue!(0.8);
    expect(P.valueAt('Sunny', 'Sunny')).toBeCloseTo(0.8, 12);
    // 0.2 : 0.1 keeps its 2:1 ratio inside the remaining 0.2
    expect(P.valueAt('Sunny', 'Cloudy')).toBeCloseTo(0.2 * (0.2 / 0.3), 12);
    expect(P.valueAt('Sunny', 'Rainy')).toBeCloseTo(0.1 * (0.2 / 0.3), 12);
    const row = ['Sunny', 'Cloudy', 'Rainy'].map((to) => P.valueAt('Sunny', to));
    expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // other rows untouched
    expect(P.valueAt('Cloudy', 'Cloudy')).toBeCloseTo(0.4, 12);
  });

  it('clamps to [0, 1] — an over-drag makes the state absorbing', () => {
    const { Prob } = setup();
    const { P } = threeState(Prob, 'renormalize-row');
    P.cell('Rainy', 'Rainy').setValue!(1.5);
    expect(P.valueAt('Rainy', 'Rainy')).toBe(1);
    expect(P.valueAt('Rainy', 'Sunny')).toBe(0);
    expect(P.valueAt('Rainy', 'Cloudy')).toBe(0);
  });

  it('when the rest of the row is zero, the remainder distributes equally', () => {
    const { Prob } = setup();
    const states = Prob.states(['A', 'B', 'C']);
    const P = Prob.stochasticMatrix({
      states,
      values: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      editable: 'renormalize-row',
    });
    P.cell('A', 'A').setValue!(0.4);
    expect(P.valueAt('A', 'B')).toBeCloseTo(0.3, 12);
    expect(P.valueAt('A', 'C')).toBeCloseTo(0.3, 12);
  });

  it('locked (the default) exposes no setValue — invalid edits unreachable', () => {
    const { Prob } = setup();
    const { P } = threeState(Prob);
    expect(P.editable).toBe('locked');
    expect(P.cell('Sunny', 'Sunny').setValue).toBeUndefined();
  });
});

describe('distribution and chain.step', () => {
  it('distribution reads mass per state, defaulting to 0', () => {
    const { Prob } = setup();
    const { states } = threeState(Prob);
    const d = Prob.distribution(states, { Sunny: 1 });
    expect(d.mass(states.state('Sunny'))).toBe(1);
    expect(d.mass(states.state('Rainy'))).toBe(0);
    expect(d.label).toBe('(1, 0, 0)');
  });

  it('step is the matrix product, with parcel trace events (the render vocabulary)', () => {
    const { world, Prob } = setup();
    const { states, P } = threeState(Prob);
    const chain = Prob.markovChain({ states, transitions: P });
    const d1 = chain.step(Prob.distribution(states, { Sunny: 1 }));
    expect(d1.mass(states.state('Sunny'))).toBeCloseTo(0.7, 12);
    expect(d1.mass(states.state('Cloudy'))).toBeCloseTo(0.2, 12);
    expect(d1.mass(states.state('Rainy'))).toBeCloseTo(0.1, 12);
    const events = world.trace(d1);
    const parcels = events.filter((e) => e.type === 'parcel');
    expect(parcels).toHaveLength(3); // one per nonzero flow out of Sunny
    const total = parcels.reduce((acc, e) => acc + (e['parcel'] as number), 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('transitions project the matrix cells: counterpart-of recorded per pair', () => {
    const { world, Prob } = setup();
    const { states, P } = threeState(Prob);
    const chain = Prob.markovChain({ states, transitions: P });
    expect(chain.transitions).toHaveLength(9);
    const t = chain.transition('Sunny', 'Rainy');
    expect(t.probability).toBeCloseTo(0.1, 12);
    const cell = P.cell('Sunny', 'Rainy');
    expect(
      world.graph
        .edgesOf(t)
        .some((e) => e.rel === 'counterpart-of' && (e.a.id === cell.id || e.b.id === cell.id)),
    ).toBe(true);
  });
});

describe('stationary — reactive derived numerics', () => {
  it('converges to the analytic stationary distribution', () => {
    const { Prob } = setup();
    const states = Prob.states(['A', 'B']);
    const P = Prob.stochasticMatrix({
      states,
      values: [
        [0.9, 0.1],
        [0.5, 0.5],
      ],
    });
    const chain = Prob.markovChain({ states, transitions: P });
    const pi = Prob.stationary(chain);
    expect(pi.mass(states.state('A'))).toBeCloseTo(5 / 6, 9);
    expect(pi.mass(states.state('B'))).toBeCloseTo(1 / 6, 9);
    expect(pi.label).toBe('π');
  });

  it('π is stationary under step (tv < 1e-9)', () => {
    const { Prob } = setup();
    const { states, P } = threeState(Prob);
    const chain = Prob.markovChain({ states, transitions: P });
    const pi = Prob.stationary(chain);
    const next = chain.step(pi);
    for (const s of states.items) {
      expect(next.mass(s)).toBeCloseTo(pi.mass(s), 9);
    }
  });

  it('RECOMPUTES when a matrix cell changes — drag moves π live (M3 Q1)', () => {
    const { Prob } = setup();
    const { states, P } = threeState(Prob, 'renormalize-row');
    const chain = Prob.markovChain({ states, transitions: P });
    const pi = Prob.stationary(chain);
    const before = states.items.map((s) => pi.mass(s));
    P.cell('Rainy', 'Rainy').setValue!(1); // Rainy becomes absorbing
    expect(pi.mass(states.state('Rainy'))).toBeCloseTo(1, 9);
    expect(pi.mass(states.state('Sunny'))).toBeCloseTo(0, 9);
    expect(before[2]).toBeLessThan(0.5); // it really moved
  });
});

describe('sampleWalk — seeded and replayable', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = setup();
    const b = setup();
    const mk = ({ Prob }: { Prob: ProbLib }, seed: number) => {
      const { states, P } = threeState(Prob);
      const chain = Prob.markovChain({ states, transitions: P });
      return Prob.sampleWalk(chain, { from: 'Sunny', steps: 12, seed });
    };
    const w1 = mk(a, 7);
    const w2 = mk(b, 7);
    expect(w1.path.map((s) => s.label)).toEqual(w2.path.map((s) => s.label));
    const w3 = mk(setup(), 8);
    expect(w3.path.map((s) => s.label)).not.toEqual(w1.path.map((s) => s.label));
  });

  it('replays its hops from provenance, one per step', () => {
    const { world, Prob } = setup();
    const { states, P } = threeState(Prob);
    const chain = Prob.markovChain({ states, transitions: P });
    const walk = Prob.sampleWalk(chain, { from: 'Sunny', steps: 8, seed: 7 });
    expect(walk.path).toHaveLength(9);
    const hops = world.trace(walk).filter((e) => e.type === 'hop');
    expect(hops).toHaveLength(8);
    hops.forEach((hop, i) => {
      expect((hop['from'] as { label: string }).label).toBe(walk.path[i]!.label);
      expect((hop['to'] as { label: string }).label).toBe(walk.path[i + 1]!.label);
    });
  });
});

// keep the unused Distribution import meaningful for the type-level check
const _typecheck = (d: Distribution): number => d.mass(d.states.items[0]!);
void _typecheck;
