import { describe, expect, it } from 'vitest';
import { createWorld } from './world.js';
import type { ActionStep, CascadeStep, LoopStep, ParallelStep, TimelineNode } from './timeline.js';

const ops = (nodes: readonly TimelineNode[]): string[] =>
  nodes.map((n) => (n.type === 'action' ? n.op : n.type));

describe('implicit sequence', () => {
  it('steps enqueue in call order', () => {
    const world = createWorld();
    world.timeline.step('say', { text: 'one' });
    world.timeline.step('show', {});
    world.timeline.step('say', { text: 'two' });
    expect(ops(world.timeline.root)).toEqual(['say', 'show', 'say']);
  });

  it('every step is a handle with a deterministic id', () => {
    const world = createWorld();
    const a = world.timeline.step('say');
    const b = world.timeline.step('show');
    expect(a.kind).toBe('step');
    expect(a.id).toBe('step#1');
    expect(b.id).toBe('step#2');
    expect(world.timeline.step('say', undefined, { id: 'finale' }).id).toBe('finale');
  });

  it('steps are immutable', () => {
    const world = createWorld();
    const s = world.timeline.step('say');
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('slot sets and collection adds interleave with authored steps in call order', () => {
    const world = createWorld();
    const s = world.slot(0);
    const c = world.collection<number>();
    world.timeline.step('say');
    s.set(1);
    c.add(2);
    world.timeline.step('show');
    expect(ops(world.timeline.root)).toEqual(['say', 'slot:set', 'collection:add', 'show']);
  });
});

describe('cascade', () => {
  it('groups per-item steps into sequential iterations with pace metadata', () => {
    const world = createWorld();
    const items = ['a', 'b', 'c'];
    const node = world.timeline.cascade(
      items,
      (item, index) => {
        world.timeline.step('show', { item, index });
        world.timeline.step('say', { item });
      },
      { pace: { start: 'slow', end: 'fast' } },
    );
    expect(node.type).toBe('cascade');
    expect(node.pace).toEqual({ start: 'slow', end: 'fast' });
    expect(node.iterations).toHaveLength(3);
    for (const [i, iteration] of node.iterations.entries()) {
      expect(ops(iteration)).toEqual(['show', 'say']);
      expect((iteration[0] as ActionStep).payload).toMatchObject({ item: items[i], index: i });
    }
  });

  it('per-item steps land inside the cascade, not on the root', () => {
    const world = createWorld();
    world.timeline.step('say');
    world.timeline.cascade([1, 2], () => {
      world.timeline.step('show');
    });
    world.timeline.step('say');
    expect(ops(world.timeline.root)).toEqual(['say', 'cascade', 'say']);
  });

  it('the iterate idiom: slot sets inside a cascade become its iterations', () => {
    const world = createWorld();
    const current = world.slot(1);
    const node = world.timeline.cascade(
      [0, 1, 2],
      () => {
        current.set(current.value * 2, { via: 'derivation' });
      },
      { pace: { start: 'slow', end: 'fast' } },
    );
    expect(current.value).toBe(8); // authoring-time state advanced
    expect(node.iterations).toHaveLength(3);
    for (const iteration of node.iterations) {
      expect(ops(iteration)).toEqual(['slot:set']);
    }
    const payloads = node.iterations.map((it) => (it[0] as ActionStep).payload) as Array<{
      from: number;
      to: number;
    }>;
    expect(payloads.map((p) => [p.from, p.to])).toEqual([
      [1, 2],
      [2, 4],
      [4, 8],
    ]);
  });

  it('an empty cascade is a valid node', () => {
    const world = createWorld();
    const node = world.timeline.cascade([], () => {
      throw new Error('per must not run');
    });
    expect(node.iterations).toEqual([]);
  });
});

describe('parallel', () => {
  it('captures steps built inside as concurrent children', () => {
    const world = createWorld();
    const node = world.timeline.parallel(() => {
      world.timeline.step('demonstrate');
      world.timeline.step('focus');
    });
    expect(node.type).toBe('parallel');
    expect(ops(node.children)).toEqual(['demonstrate', 'focus']);
    expect(ops(world.timeline.root)).toEqual(['parallel']);
  });

  it('restores the enclosing container after the build, even on throw', () => {
    const world = createWorld();
    expect(() =>
      world.timeline.parallel(() => {
        world.timeline.step('demonstrate');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    world.timeline.step('say');
    expect(ops(world.timeline.root)).toEqual(['say']);
  });

  it('nests inside cascade iterations', () => {
    const world = createWorld();
    const node = world.timeline.cascade([1, 2], () => {
      world.timeline.step('show');
      world.timeline.parallel(() => {
        world.timeline.step('demonstrate');
        world.timeline.step('focus');
      });
    });
    const first = node.iterations[0]!;
    expect(ops(first)).toEqual(['show', 'parallel']);
    expect(ops((first[1] as ParallelStep).children)).toEqual(['demonstrate', 'focus']);
  });
});

describe('loop', () => {
  it('captures children with an optional repeat count', () => {
    const world = createWorld();
    const ambient = world.timeline.loop(() => {
      world.timeline.step('demonstrate', { intensity: 'ambient' });
    });
    expect(ambient.type).toBe('loop');
    expect(ambient.times).toBeUndefined(); // until superseded
    expect(ops(ambient.children)).toEqual(['demonstrate']);

    const bounded = world.timeline.loop(
      () => {
        world.timeline.step('show');
      },
      { times: 3 },
    );
    expect((bounded as LoopStep).times).toBe(3);
  });

  it('the ambient-flow idiom: loop inside parallel', () => {
    const world = createWorld();
    const node = world.timeline.parallel(() => {
      world.timeline.loop(() => {
        world.timeline.step('demonstrate');
      });
      world.timeline.step('focus', { emphasize: 'stillness' });
    });
    expect(ops(node.children)).toEqual(['loop', 'focus']);
  });
});

describe('nesting and ordering, combined', () => {
  it('reproduces a beats-shaped program structure', () => {
    const world = createWorld();
    const t = world.timeline;
    t.step('say');
    t.step('show');
    const casc = t.cascade(['0', '00', '01'], (w) => {
      t.step('show', { w });
      t.step('collection:seed', { w });
    });
    t.step('morph');
    const par = t.parallel(() => {
      t.loop(() => t.step('demonstrate'));
      t.step('focus');
    });
    t.step('say');

    expect(ops(t.root)).toEqual(['say', 'show', 'cascade', 'morph', 'parallel', 'say']);
    expect((t.root[2] as CascadeStep).iterations).toHaveLength(3);
    expect(ops((t.root[4] as ParallelStep).children)).toEqual(['loop', 'focus']);
    // ids reflect creation order: cascade minted before its children
    const ids = t.root.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
