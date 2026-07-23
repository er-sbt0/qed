/**
 * integration.test.ts — the milestone-1 slice, exercised against the real
 * core: a distribution-shaped `step` op driving a slot under a cascade, and a
 * partition re-bucketing a growing word stream with a machine derived from it.
 * No verbs, no views — just the value/reactivity/provenance/timeline substrate
 * a lesson program needs.
 *
 * The two scenarios are built here from core ops, not imported from any lesson:
 * they pin the SUBSTRATE, and nothing about them should move when the example
 * corpus is re-recorded.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from './world.js';
import type { Handle } from './identity.js';
import type { ActionStep, CascadeStep } from './timeline.js';

interface Dist extends Handle<'distribution'> {
  readonly mass: Readonly<Record<string, number>>;
}

describe('distribution slice: iterate under cascade, provenance replayed on demand', () => {
  function setup() {
    const world = createWorld();
    const states = ['Sunny', 'Rainy'] as const;
    const P: Record<string, Record<string, number>> = {
      Sunny: { Sunny: 0.9, Rainy: 0.1 },
      Rainy: { Sunny: 0.5, Rainy: 0.5 },
    };
    let bodyRuns = 0;
    const step = world.defineOp(
      'chain.step',
      (ctx, d: Dist): Dist => {
        bodyRuns += 1;
        const mass: Record<string, number> = { Sunny: 0, Rainy: 0 };
        for (const from of states) {
          for (const to of states) {
            const parcel = d.mass[from]! * P[from]![to]!;
            mass[to]! += parcel;
            // per-parcel detail stays lazy: a trace event, not a stored edge
            ctx.trace({ type: 'parcel', from, to, parcel });
          }
        }
        return ctx.value('distribution', { mass: Object.freeze(mass) });
      },
      { autoEdges: false }, // hot path: no per-frame graph growth
    );
    const dist = world.defineOp('dist.of', (ctx, mass: Readonly<Record<string, number>>) =>
      ctx.value('distribution', { mass }),
    );
    return { world, step, dist, bodyRuns: () => bodyRuns };
  }

  it('slot.set(chain.step(slot.value)) under cascade advances state and structures the timeline', () => {
    const { world, step, dist } = setup();
    const p0 = dist({ Sunny: 1, Rainy: 0 });
    const current = world.slot<Dist>(p0, { id: 'current' });

    const casc = world.timeline.cascade(
      [0, 1, 2],
      () => {
        current.set(step(current.value), { via: 'derivation' });
      },
      { pace: { start: 'slow', end: 'fast' } },
    );

    // authoring-time value advanced three steps toward equilibrium
    expect(current.value.mass['Sunny']).toBeCloseTo(0.844, 3);
    // timeline: one cascade node, three iterations of one slot:set each
    expect(casc.iterations).toHaveLength(3);
    for (const it of casc.iterations) {
      expect((it[0] as ActionStep).op).toBe('slot:set');
      expect(((it[0] as ActionStep).payload as { via: string }).via).toBe('derivation');
    }
  });

  it('a subscribed history fold sees every transition in order — the free history view', () => {
    const { world, step, dist } = setup();
    const p0 = dist({ Sunny: 0, Rainy: 1 });
    const current = world.slot<Dist>(p0);
    const history: number[] = [p0.mass['Rainy']!];
    current.subscribe((t) => history.push(t.to.mass['Rainy']!));
    for (let i = 0; i < 3; i += 1) current.set(step(current.value), { via: 'derivation' });
    expect(history).toEqual([1, 0.5, 0.3, 0.22].map((x) => expect.closeTo(x, 5)));
  });

  it('set({via:"derivation"}) can replay the new value lazily: parcels re-derived, ids stable', () => {
    const { world, step, dist, bodyRuns } = setup();
    const p0 = dist({ Sunny: 1, Rainy: 0 });
    const p1 = step(p0);
    expect(bodyRuns()).toBe(1);

    // what milestone 2's demonstrate / via:"derivation" will do:
    const events = world.trace(p1);
    expect(bodyRuns()).toBe(2); // re-ran exactly once, on demand
    const parcels = events.filter((e) => e.type === 'parcel');
    expect(parcels).toHaveLength(4);
    expect(parcels.map((p) => p.parcel as number).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // provenance is the record (operation, inputs)
    expect(world.provenanceOf(p1)).toEqual({ operation: 'chain.step', inputs: [p0] });
  });

  it('hot-path derivations do not grow the correspondence graph per step', () => {
    const { world, step, dist } = setup();
    let d = dist({ Sunny: 1, Rainy: 0 });
    const before = world.graph.edges.length;
    for (let i = 0; i < 50; i += 1) d = step(d); // 50 "frames" of drag
    expect(world.graph.edges.length).toBe(before);
    expect(world.provenanceOf(d)).toBeDefined(); // provenance still recorded
  });
});

describe('myhill-nerode slice: growing stream re-buckets; machine derived with counterparts', () => {
  it('carries the collapse and reinterpretation beats structurally', () => {
    const world = createWorld();

    interface Word extends Handle<'word'> {
      readonly text: string;
    }
    const wordOf = world.defineOp('word.of', (ctx, text: string): Word =>
      ctx.value('word', { text }),
    );

    // beat 3 — the collapse: partition derived from a reactive collection
    const words = world.collection<Word>([wordOf(''), wordOf('0'), wordOf('1')]);
    const parity = (w: Word) => (w.text.match(/1/g)?.length ?? 0) % 2;
    const partition = world.incremental(words, {
      init: (items) => {
        const buckets = new Map<number, readonly Word[]>();
        for (const w of items) buckets.set(parity(w), [...(buckets.get(parity(w)) ?? []), w]);
        return buckets;
      },
      apply: (buckets, delta) => {
        const k = parity(delta.item);
        const next = new Map(buckets);
        next.set(k, [...(next.get(k) ?? []), delta.item]);
        return next;
      },
    });
    expect(partition.value.size).toBe(2);

    // the "infinitely many strings" idiom: cascade a stream of arrivals
    const arrivals: number[] = [];
    partition.subscribe((c) => arrivals.push(parity(c.delta!.item)));
    const more = ['11', '10', '111'];
    world.timeline.cascade(more, (text) => {
      words.add(wordOf(text));
    });
    expect(arrivals).toEqual([0, 1, 1]);
    expect(partition.value.size).toBe(2); // no third bucket ever appears

    // beat 4 — the reinterpretation: a machine derived from the partition,
    // class↔state counterpart-of edges recorded by construction
    interface ClassHandle extends Handle<'class'> {
      readonly label: string;
    }
    const classes: ClassHandle[] = [
      Object.freeze({ ...world.handle('class', 'even'), label: 'EVEN' }),
      Object.freeze({ ...world.handle('class', 'odd'), label: 'ODD' }),
    ];
    const machineOf = world.defineOp('machine.of', (ctx, from: readonly ClassHandle[]) => {
      const states = from.map((cls) => {
        const state = ctx.value('state', { label: cls.label });
        ctx.link(cls, state, 'counterpart-of');
        return state;
      });
      const m = ctx.value('machine', { states });
      ctx.link(m, states, 'contributes-to');
      return m;
    });
    const machine = machineOf(classes);

    // morph legality (milestone 2) will ask exactly this reachability question:
    for (const [i, cls] of classes.entries()) {
      expect(world.graph.reachable(cls, machine.states[i]!)).toBe(true);
    }
    // and multi-hop: a class reaches the machine through its counterpart state
    expect(
      world.graph.reachable(classes[0]!, machine, { rels: ['counterpart-of', 'contributes-to'] }),
    ).toBe(true);

    // the timeline recorded the stream as one cascade of adds
    const root = world.timeline.root;
    const cascades = root.filter((n): n is CascadeStep => n.type === 'cascade');
    expect(cascades).toHaveLength(1);
    expect(cascades[0]!.iterations.every((it) => (it[0] as ActionStep).op === 'collection:add')).toBe(
      true,
    );
  });
});
