import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import { createClaim } from './claim.js';
import { createParameter } from './parameter.js';
import { derivedNumber } from './numeric.js';
import { createViews } from './views.js';

describe('M.claim', () => {
  it('holds when the relation is satisfied and breaks when it is not', () => {
    const world = createWorld();
    const x = createParameter(world, 'x', 2, [0, 10]);
    const c = createClaim(world, { lhs: x, rhs: 2, relation: '=' });

    expect(c.holds).toBe(true);
    expect(c.status).toEqual({ label: 'holds', polarity: 'accept' });

    x.setValue(5);
    expect(c.holds).toBe(false);
    expect(c.status.polarity).toBe('reject');
    expect(c.gap?.value).toBe(3);
  });

  it('re-derives through a live drag (setValueLive), not only a timeline step', () => {
    const world = createWorld();
    const w = createParameter(world, 'w', 3, [0, 10]);
    const doubled = derivedNumber(world, () => w.value * 2, '2w');
    const c = createClaim(world, { lhs: doubled, rhs: 6 });

    expect(c.holds).toBe(true);
    w.setValueLive(4);
    expect(c.holds).toBe(false);
    w.setValueLive(3);
    expect(c.holds).toBe(true);
  });

  it('is a theorem when no reachable state flips it', () => {
    const world = createWorld();
    const x = createParameter(world, 'x', 1, [-5, 5]);
    // (x+1)^2 = x^2 + 2x + 1 — true for every x the student can reach.
    const lhs = derivedNumber(world, () => (x.value + 1) ** 2);
    const rhs = derivedNumber(world, () => x.value ** 2 + 2 * x.value + 1);
    const c = createClaim(world, { lhs, rhs, relation: '≈' });

    for (let v = -5; v <= 5; v += 0.5) {
      x.setValueLive(v);
      expect(c.holds).toBe(true);
    }
  });

  it('honours tolerance, and ≈ is looser than = by default', () => {
    const world = createWorld();
    const exact = createClaim(world, { lhs: 1.001, rhs: 1, relation: '=' });
    const approx = createClaim(world, { lhs: 1.001, rhs: 1, relation: '≈' });
    const tight = createClaim(world, { lhs: 1.001, rhs: 1, relation: '≈', tolerance: 1e-4 });

    expect(exact.holds).toBe(false);
    expect(approx.holds).toBe(true);
    expect(tight.holds).toBe(false);
  });

  it('supports the ordering relations', () => {
    const world = createWorld();
    const t = createParameter(world, 't', 4, [0, 10]);
    const le = createClaim(world, { lhs: t, rhs: 5, relation: '<=' });
    const gt = createClaim(world, { lhs: t, rhs: 5, relation: '>' });

    expect([le.holds, gt.holds]).toEqual([true, false]);
    t.setValue(6);
    expect([le.holds, gt.holds]).toEqual([false, true]);
    t.setValue(5);
    expect([le.holds, gt.holds]).toEqual([true, false]);
  });

  it('takes a predicate closure for non-numeric propositions', () => {
    const world = createWorld();
    const n = createParameter(world, 'n', 4, [1, 10]);
    const c = createClaim(world, { predicate: () => n.value % 2 === 0, label: 'n is even' });

    expect(c.holds).toBe(true);
    expect(c.lhs).toBeUndefined();
    n.setValue(5);
    expect(c.holds).toBe(false);
  });

  it('rejects a snapshot side — a claim that can never break proves nothing', () => {
    const world = createWorld();
    expect(() => createClaim(world, { lhs: undefined as never, rhs: 1 })).toThrow(/LIVE numeric handle/);
    expect(() => createClaim(world, { lhs: 1, rhs: { id: 'x', kind: 'scalar' } as never })).toThrow(
      /LIVE numeric handle/,
    );
  });
});

describe('View.claim', () => {
  it('reads the live status headlessly and tracks a drag', () => {
    const world = createWorld();
    const stage = createStage(world);
    const { View } = createViews(stage);
    const x = createParameter(world, 'x', 2, [0, 10]);
    const c = createClaim(world, { lhs: x, rhs: 2, relation: '=', label: 'x = 2' });
    const view = View.claim(c);

    expect(view.values()).toMatchObject({ holds: true, lhs: 2, rhs: 2, gap: 0 });
    expect(view.elements.map((e) => e.kind)).toEqual(['claim', 'parameter', 'scalar']);

    x.setValueLive(3);
    expect(view.values()).toMatchObject({ holds: false, gap: 1 });
    expect(view.values().status.polarity).toBe('reject');
  });

  it('refuses anything that is not a claim', () => {
    const world = createWorld();
    const stage = createStage(world);
    const { View } = createViews(stage);
    expect(() => View.claim(undefined as never)).toThrow(/needs a claim handle/);
  });
});
