/**
 * morph.test.ts — the legality rule and route production.
 *
 * morph(A, B) is legal iff every element of A reaches an element of B through
 * the correspondence graph; the step payload carries the routed edge paths.
 * Values derived by `autoEdges: false` operations route through provenance.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, Handle, World } from '@math-ai/core';
import { createLesson } from './lesson.js';
import type { MorphPayload, MorphSubject } from './types.js';

interface Thing extends Handle<'thing'> {
  readonly tag: string;
}

function view(world: World, kind: string, elements: readonly Handle[]): MorphSubject {
  return Object.freeze({ ...world.handle(kind), elements });
}

function setup() {
  const world = createWorld();
  const lesson = createLesson(world);
  const thing = world.defineOp('thing.of', (ctx, tag: string): Thing => ctx.value('thing', { tag }));
  return { world, lesson, thing };
}

describe('morph legality and routes', () => {
  it('same underlying object: route with zero hops', () => {
    const { world, lesson, thing } = setup();
    const w = thing('w');
    const step = lesson.morph(view(world, 'view:a', [w]), view(world, 'view:b', [w]), {
      preserveIdentity: true,
    });
    const payload = (step as ActionStep).payload as MorphPayload;
    expect(payload.routes).toHaveLength(1);
    expect(payload.routes[0]).toMatchObject({ from: w, to: w, hops: [] });
    expect(payload.preserveIdentity).toBe(true);
  });

  it('routes along by-construction edges (auto came-from)', () => {
    const { world, lesson, thing } = setup();
    const derive = world.defineOp('thing.derive', (ctx, base: Thing): Thing =>
      ctx.value('thing', { tag: base.tag + "'" }),
    );
    const base = thing('a');
    const derived = derive(base); // came-from edge recorded by construction
    const step = lesson.morph(view(world, 'view:a', [derived]), view(world, 'view:b', [base]), {
      preserveIdentity: true,
    });
    const route = ((step as ActionStep).payload as MorphPayload).routes[0]!;
    expect(route.hops).toHaveLength(1);
    expect(route.hops[0]).toMatchObject({ via: 'edge' });
    const hop = route.hops[0]!;
    if (hop.via !== 'edge') throw new Error('expected an edge hop');
    expect(hop.edge.rel).toBe('came-from');
    expect(hop.edge.origin).toBe('construction');
  });

  it('routes along authored edges and multi-hop paths', () => {
    const { world, lesson, thing } = setup();
    const cls = thing('EVEN');
    const state = thing('even-state');
    const node = thing('graph-node');
    world.link(cls, state, 'counterpart-of');
    world.link(state, node, 'represents');
    const step = lesson.morph(view(world, 'view:a', [cls]), view(world, 'view:b', [node]), {
      preserveIdentity: true,
    });
    const route = ((step as ActionStep).payload as MorphPayload).routes[0]!;
    expect(route.to).toBe(node);
    expect(route.hops.map((h) => (h.via === 'edge' ? h.edge.rel : h.via))).toEqual([
      'counterpart-of',
      'represents',
    ]);
  });

  it('each source element routes to its own nearest target element', () => {
    const { world, lesson, thing } = setup();
    const a = thing('a');
    const b = thing('b');
    const bucketA = thing('bucket-a');
    const bucketB = thing('bucket-b');
    world.link(a, bucketA, 'contributes-to');
    world.link(b, bucketB, 'contributes-to');
    const step = lesson.morph(
      view(world, 'view:cloud', [a, b]),
      view(world, 'view:buckets', [bucketA, bucketB]),
      { preserveIdentity: true },
    );
    const routes = ((step as ActionStep).payload as MorphPayload).routes;
    expect(routes.map((r) => [r.from.id, r.to.id])).toEqual([
      [a.id, bucketA.id],
      [b.id, bucketB.id],
    ]);
  });

  it('a subject without declared elements is its own single element', () => {
    const { world, lesson, thing } = setup();
    const a = thing('a');
    const b = thing('b');
    world.link(a, b, 'maps-to');
    const step = lesson.morph(a, b, { preserveIdentity: true });
    const routes = ((step as ActionStep).payload as MorphPayload).routes;
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ from: a, to: b });
  });
});

describe('morph vs autoEdges: false (provenance fallback)', () => {
  it('hot-path values route through their provenance inputs (derivation hops)', () => {
    const { world, lesson, thing } = setup();
    const hot = world.defineOp(
      'hot.step',
      (ctx, base: Thing): Thing => ctx.value('thing', { tag: base.tag + '*' }),
      { autoEdges: false },
    );
    const base = thing('d0');
    const result = hot(base);
    expect(world.graph.edgesOf(result)).toHaveLength(0); // invisible to the graph
    const step = lesson.morph(view(world, 'view:a', [result]), view(world, 'view:b', [base]), {
      preserveIdentity: true,
    });
    const route = ((step as ActionStep).payload as MorphPayload).routes[0]!;
    expect(route.hops).toHaveLength(1);
    expect(route.hops[0]).toMatchObject({
      via: 'derivation',
      operation: 'hot.step',
      value: result,
      input: base,
    });
  });

  it('routes when the TARGET was derived from the source by a hot op', () => {
    const { world, lesson, thing } = setup();
    const hot = world.defineOp(
      'hot.step',
      (ctx, base: Thing): Thing => ctx.value('thing', { tag: base.tag + '*' }),
      { autoEdges: false },
    );
    const base = thing('d0');
    const result = hot(base);
    const step = lesson.morph(view(world, 'view:a', [base]), view(world, 'view:b', [result]), {
      preserveIdentity: true,
    });
    const route = ((step as ActionStep).payload as MorphPayload).routes[0]!;
    expect(route.to).toBe(result);
    expect(route.hops[0]).toMatchObject({ via: 'derivation', operation: 'hot.step' });
  });

  it('mixes correspondence and derivation hops in one route', () => {
    const { world, lesson, thing } = setup();
    const hot = world.defineOp(
      'hot.step',
      (ctx, base: Thing): Thing => ctx.value('thing', { tag: base.tag + '*' }),
      { autoEdges: false },
    );
    const anchor = thing('anchor');
    const base = thing('d0');
    world.link(base, anchor, 'represents'); // base is graph-connected
    const result = hot(base); // result is only provenance-connected to base
    const step = lesson.morph(view(world, 'view:a', [result]), view(world, 'view:b', [anchor]), {
      preserveIdentity: true,
    });
    const route = ((step as ActionStep).payload as MorphPayload).routes[0]!;
    expect(route.hops.map((h) => h.via)).toEqual(['derivation', 'edge']);
  });
});

describe('illegal morphs', () => {
  it('raises a diagnostic listing every unreachable element', () => {
    const { world, lesson, thing } = setup();
    const connected = thing('ok');
    const stray1 = thing('stray-one');
    const stray2 = thing('stray-two');
    const target = thing('target');
    world.link(connected, target, 'maps-to');
    const from = view(world, 'view:a', [connected, stray1, stray2]);
    const to = view(world, 'view:b', [target]);
    expect(() => lesson.morph(from, to, { preserveIdentity: true })).toThrow(
      /2 of 3 source element\(s\)/,
    );
    try {
      lesson.morph(from, to, { preserveIdentity: true });
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain(`${stray1.id} (thing)`);
      expect(message).toContain(`${stray2.id} (thing)`);
      expect(message).not.toContain(`- ${connected.id}`);
      expect(message).toContain(target.id); // targets considered are named
      expect(message).toContain('autoEdges: false'); // the hint
    }
  });

  it('an illegal morph enqueues nothing', () => {
    const { world, lesson, thing } = setup();
    const a = thing('a');
    const b = thing('b'); // unrelated
    const before = world.timeline.root.length;
    expect(() =>
      lesson.morph(view(world, 'view:a', [a]), view(world, 'view:b', [b]), {
        preserveIdentity: true,
      }),
    ).toThrow();
    expect(world.timeline.root.length).toBe(before);
  });
});
