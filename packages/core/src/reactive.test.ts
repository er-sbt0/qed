import { describe, expect, it } from 'vitest';
import { createWorld } from './world.js';
import type { ActionStep } from './timeline.js';

describe('Slot', () => {
  it('is a handle with a deterministic id', () => {
    const world = createWorld();
    const s = world.slot(0);
    expect(s.kind).toBe('slot');
    expect(s.id).toBe('slot#1');
    expect(world.slot(1, { id: 'current' }).id).toBe('current');
  });

  it('set applies immediately and returns a timeline step', () => {
    const world = createWorld();
    const s = world.slot(10);
    const step = s.set(20, { via: 'derivation' });
    expect(s.value).toBe(20);
    expect(step.kind).toBe('step');
    const action = step as ActionStep;
    expect(action.op).toBe('slot:set');
    expect(action.payload).toMatchObject({ from: 10, to: 20, via: 'derivation' });
    expect((action.payload as { slot: unknown }).slot).toBe(s);
    expect(world.timeline.root).toContain(step);
  });

  it('subscribers see the transition {from, to, via, step}', () => {
    const world = createWorld();
    const s = world.slot('a');
    const seen: Array<{ from: string; to: string; via?: string }> = [];
    s.subscribe((t) => seen.push({ from: t.from, to: t.to, via: t.via }));
    const step = s.set('b', { via: 'fade' });
    expect(seen).toEqual([{ from: 'a', to: 'b', via: 'fade' }]);
    s.subscribe((t) => expect(t.step).toBeDefined());
    void step;
  });

  it('notifies subscribers in subscription order', () => {
    const world = createWorld();
    const s = world.slot(0);
    const order: string[] = [];
    s.subscribe(() => order.push('first'));
    s.subscribe(() => order.push('second'));
    s.subscribe(() => order.push('third'));
    s.set(1);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('unsubscribe stops notifications', () => {
    const world = createWorld();
    const s = world.slot(0);
    let count = 0;
    const off = s.subscribe(() => {
      count += 1;
    });
    s.set(1);
    off();
    s.set(2);
    expect(count).toBe(1);
  });

  it('setting an equal value still records the step but does not notify', () => {
    const world = createWorld();
    const s = world.slot(5);
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    const step = s.set(5);
    expect(count).toBe(0);
    expect(world.timeline.root).toContain(step); // the author asked for a step
  });

  it('honors a custom equality function', () => {
    const world = createWorld();
    const s = world.slot({ x: 1 }, { equals: (a, b) => a.x === b.x });
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.set({ x: 1 });
    expect(count).toBe(0);
    s.set({ x: 2 });
    expect(count).toBe(1);
  });

  it('supports the iterate idiom: set(f(value)) reads the fresh value', () => {
    const world = createWorld();
    const s = world.slot(1);
    for (let i = 0; i < 5; i += 1) s.set(s.value * 2);
    expect(s.value).toBe(32);
    expect(world.timeline.root).toHaveLength(5);
  });
});

describe('Derived: dirty propagation', () => {
  it('is lazy: does not compute until first read', () => {
    const world = createWorld();
    let computes = 0;
    const s = world.slot(2);
    const d = world.derived(() => {
      computes += 1;
      return s.value * 10;
    });
    expect(computes).toBe(0);
    expect(d.value).toBe(20);
    expect(computes).toBe(1);
  });

  it('caches: repeated reads do not recompute', () => {
    const world = createWorld();
    let computes = 0;
    const s = world.slot(2);
    const d = world.derived(() => {
      computes += 1;
      return s.value * 10;
    });
    d.value;
    d.value;
    d.peek();
    expect(computes).toBe(1);
  });

  it('recomputes after a source change, but only when pulled', () => {
    const world = createWorld();
    let computes = 0;
    const s = world.slot(2);
    const d = world.derived(() => {
      computes += 1;
      return s.value * 10;
    });
    expect(d.value).toBe(20);
    s.set(3);
    expect(computes).toBe(1); // stale, not yet recomputed
    expect(d.value).toBe(30);
    expect(computes).toBe(2);
  });

  it('propagates staleness through chains of deriveds', () => {
    const world = createWorld();
    const s = world.slot(1);
    const double = world.derived(() => s.value * 2);
    const quad = world.derived(() => double.value * 2);
    expect(quad.value).toBe(4);
    s.set(5);
    expect(quad.value).toBe(20);
  });

  it('diamond dependencies recompute once per change, glitch-free', () => {
    const world = createWorld();
    const s = world.slot(1);
    const left = world.derived(() => s.value + 1);
    const right = world.derived(() => s.value * 10);
    let computes = 0;
    const join = world.derived(() => {
      computes += 1;
      return left.value + right.value;
    });
    const seen: number[] = [];
    join.subscribe((c) => seen.push(c.to));
    expect(join.value).toBe(12);
    computes = 0;
    s.set(2);
    expect(computes).toBe(1); // exactly one recompute despite two stale inputs
    expect(seen).toEqual([23]); // consistent: (2+1) + (2*10)
  });

  it('subscribed deriveds recompute eagerly and report {from, to}', () => {
    const world = createWorld();
    const s = world.slot(2);
    const d = world.derived(() => s.value * 10);
    const seen: Array<{ from: number; to: number }> = [];
    d.subscribe((c) => seen.push(c));
    s.set(3);
    expect(seen).toEqual([{ from: 20, to: 30 }]);
  });

  it('does not notify when the recomputed value is equal', () => {
    const world = createWorld();
    const s = world.slot(4);
    const parity = world.derived(() => s.value % 2);
    let count = 0;
    parity.subscribe(() => {
      count += 1;
    });
    s.set(6); // parity unchanged
    expect(count).toBe(0);
    s.set(7);
    expect(count).toBe(1);
  });

  it('tracks dependencies dynamically: unused sources stop triggering', () => {
    const world = createWorld();
    const useA = world.slot(true);
    const a = world.slot('a');
    const b = world.slot('b');
    let computes = 0;
    const d = world.derived(() => {
      computes += 1;
      return useA.value ? a.value : b.value;
    });
    expect(d.value).toBe('a');
    useA.set(false);
    expect(d.value).toBe('b');
    computes = 0;
    a.set('a2'); // no longer a dependency
    expect(d.value).toBe('b');
    expect(computes).toBe(0);
    b.set('b2');
    expect(d.value).toBe('b2');
    expect(computes).toBe(1);
  });

  it('a derived numeric over dragged inputs recomputes per set (the drag path)', () => {
    const world = createWorld();
    const cell = world.slot(0.5);
    const derived = world.derived(() => 1 - cell.value);
    const frames: number[] = [];
    derived.subscribe((c) => frames.push(c.to));
    for (const v of [0.6, 0.7, 0.8]) cell.set(v);
    expect(frames.map((f) => Math.round(f * 10) / 10)).toEqual([0.4, 0.3, 0.2]);
  });

  it('detects computation cycles instead of looping', () => {
    const world = createWorld();
    // eslint-disable-next-line prefer-const
    let d: { value: number };
    d = world.derived((): number => d.value + 1);
    expect(() => d.value).toThrow(/cycle/);
  });
});

describe('dependsOn: the graph made queryable (roadmap 4c)', () => {
  it('a derived names exactly the sources its current value read', () => {
    const world = createWorld();
    const a = world.slot(1);
    const b = world.slot(2);
    const sum = world.derived(() => a.value + b.value);
    expect(sum.dependsOn().map((h) => h.id)).toEqual([a.id, b.id]);
  });

  it('edges are DYNAMIC: a branch not taken is not a dependency', () => {
    const world = createWorld();
    const gate = world.slot(true);
    const left = world.slot(10);
    const right = world.slot(20);
    const pick = world.derived(() => (gate.value ? left.value : right.value));
    expect(pick.dependsOn().map((h) => h.id)).toEqual([gate.id, left.id]);
    gate.set(false);
    // dependsOn pulls first, so the edges describe the value it would answer
    // with now — right is in, left is out
    expect(pick.dependsOn().map((h) => h.id)).toEqual([gate.id, right.id]);
  });

  it('a chain is walkable: derived → derived → slot', () => {
    const world = createWorld();
    const x = world.slot(3);
    const sq = world.derived(() => x.value * x.value);
    const neg = world.derived(() => -sq.value);
    const [dep] = neg.dependsOn();
    expect(dep!.id).toBe(sq.id);
    expect(sq.dependsOn().map((h) => h.id)).toEqual([x.id]);
  });

  it('an incremental has one fixed edge: its source collection', () => {
    const world = createWorld();
    const items = world.collection([1, 2]);
    const total = world.incremental(items, {
      init: (xs) => xs.reduce((s, n) => s + n, 0),
      apply: (s, d) => s + d.item,
    });
    expect(total.dependsOn().map((h) => h.id)).toEqual([items.id]);
    // and a derived reading it links the two, so a walk crosses the seam
    const doubled = world.derived(() => 2 * total.value);
    expect(doubled.dependsOn().map((h) => h.id)).toEqual([total.id]);
  });
});
