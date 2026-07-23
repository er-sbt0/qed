import { describe, expect, it } from 'vitest';
import { createWorld } from './world.js';
import type { Handle } from './identity.js';

interface Word extends Handle<'word'> {
  readonly text: string;
}

/** A little markov-shaped fixture: ops with trace events and derived values. */
function fixture() {
  const world = createWorld();
  let runs = 0;
  const word = world.defineOp('word.of', (ctx, text: string) => ctx.value('word', { text }));
  const append = world.defineOp('word.append', (ctx, base: Word, suffix: string): Word => {
    runs += 1;
    const result = ctx.value('word', { text: base.text + suffix });
    ctx.trace({ type: 'append', base, suffix, result });
    return result;
  });
  return { world, word, append, runs: () => runs };
}

describe('provenance recording', () => {
  it('derived values carry a lazy (operation, inputs) record', () => {
    const { world, word, append } = fixture();
    const x = word('0');
    const xz = append(x, '1');
    expect(xz.text).toBe('01');
    const p = world.provenanceOf(xz);
    expect(p).toBeDefined();
    expect(p!.operation).toBe('word.append');
    expect(p!.inputs).toEqual([x, '1']);
  });

  it('values not created by an operation carry no provenance', () => {
    const { world } = fixture();
    expect(world.provenanceOf(world.handle('word'))).toBeUndefined();
    expect(() => world.trace(world.handle('word'))).toThrow(/no provenance/);
  });

  it('derived values are frozen and identity-bearing', () => {
    const { word } = fixture();
    const x = word('0');
    expect(Object.isFrozen(x)).toBe(true);
    expect(x.kind).toBe('word');
    expect(x.id).toMatch(/^word#\d+$/);
  });

  it('records automatic came-from edges to Handle-typed inputs', () => {
    const { world, word, append } = fixture();
    const x = word('0');
    const xz = append(x, '1');
    expect(world.graph.reachable(xz, x, { rels: ['came-from'] })).toBe(true);
  });

  it('autoEdges: false suppresses automatic edges but keeps provenance', () => {
    const world = createWorld();
    const word = world.defineOp('word.of', (ctx, text: string) => ctx.value('word', { text }));
    const hot = world.defineOp(
      'hot.step',
      (ctx, w: Word) => ctx.value('word', { text: w.text }),
      { autoEdges: false },
    );
    const x = word('a');
    const y = hot(x);
    expect(world.graph.edgesOf(y)).toHaveLength(0);
    expect(world.provenanceOf(y)?.operation).toBe('hot.step');
  });

  it('ctx.link records by-construction edges during the normal run', () => {
    const world = createWorld();
    const op = world.defineOp('derive', (ctx) => {
      const a = ctx.value('class', { label: 'A' });
      const b = ctx.value('state', { label: 'A' });
      ctx.link(a, b, 'counterpart-of');
      return { a, b };
    });
    const { a, b } = op();
    const edge = world.graph.edgesOf(a).find((e) => e.rel === 'counterpart-of');
    expect(edge).toMatchObject({ origin: 'construction' });
    expect(world.graph.reachable(a, b)).toBe(true);
  });

  it('rejects duplicate operation names', () => {
    const world = createWorld();
    world.defineOp('op', (ctx) => ctx.value('x', {}));
    expect(() => world.defineOp('op', (ctx) => ctx.value('x', {}))).toThrow(/already defined/);
  });
});

describe('lazy trace re-derivation', () => {
  it('the op body does not re-run until a trace is demanded', () => {
    const { world, word, append, runs } = fixture();
    const xz = append(word('0'), '1');
    expect(runs()).toBe(1); // the original derivation only
    const events = world.trace(xz);
    expect(runs()).toBe(2); // replayed exactly once, on demand
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('append');
  });

  it('trace events are collected only in traced mode', () => {
    const { world, word, append } = fixture();
    const xz = append(word('0'), '1');
    // the normal run produced no observable events anywhere; only trace() returns them
    const events = world.trace(xz);
    expect(events.map((e) => e.type)).toEqual(['append']);
  });

  it('replayed values reproduce the original ids exactly', () => {
    const { world, word, append } = fixture();
    const x = word('0');
    const xz = append(x, '1');
    const events = world.trace(xz);
    const replayed = events[0]!.result as Word;
    expect(replayed.id).toBe(xz.id);
    expect(replayed.text).toBe(xz.text);
    expect(replayed).not.toBe(xz); // a fresh immutable value, same identity
  });

  it('replay is deterministic: tracing twice yields identical events', () => {
    const { world, word, append } = fixture();
    const xz = append(word('0'), '1');
    expect(world.trace(xz)).toEqual(world.trace(xz));
  });

  it('replay does not grow the correspondence graph or the timeline', () => {
    const world = createWorld();
    const op = world.defineOp('derive', (ctx, base: Handle) => {
      const v = ctx.value('thing', {});
      ctx.link(v, base, 'counterpart-of');
      ctx.trace({ type: 'made', v });
      return v;
    });
    const v = op(world.handle('base'));
    const edgeCount = world.graph.edges.length;
    const stepCount = world.timeline.root.length;
    world.trace(v);
    expect(world.graph.edges.length).toBe(edgeCount);
    expect(world.timeline.root.length).toBe(stepCount);
  });

  it('replay does not disturb the live id sequence', () => {
    const { world, word, append } = fixture();
    const xz = append(word('0'), '1');
    world.trace(xz);
    // next mint continues where the real registry left off, unaffected by replay
    expect(world.handle('word').id).toBe('word#3');
  });

  it('nested operations replay through the same trace with original ids', () => {
    const world = createWorld();
    const inner = world.defineOp('inner', (ctx, n: number) => {
      const v = ctx.value('num', { n });
      ctx.trace({ type: 'inner', v });
      return v;
    });
    const outer = world.defineOp('outer', (ctx, n: number) => {
      const a = inner(n);
      const b = ctx.value('pair', { a });
      ctx.trace({ type: 'outer', b });
      return b;
    });
    const pair = outer(7);
    const innerOriginalId = (pair as unknown as { a: Handle }).a.id;
    const events = world.trace(pair);
    expect(events.map((e) => e.type)).toEqual(['inner', 'outer']);
    const replayedInner = events[0]!.v as Handle;
    const replayedOuter = events[1]!.b as Handle;
    expect(replayedInner.id).toBe(innerOriginalId);
    expect(replayedOuter.id).toBe(pair.id);
  });

  it('explicit ids inside op bodies replay to the same explicit ids', () => {
    const world = createWorld();
    const op = world.defineOp('mk', (ctx) => {
      const v = ctx.value('state', { label: 'rainy' }, { id: 'rainy' });
      ctx.trace({ type: 'made', v });
      return v;
    });
    const v = op();
    expect(v.id).toBe('rainy');
    const events = world.trace(v);
    expect((events[0]!.v as Handle).id).toBe('rainy');
  });
});

describe('operation purity guards', () => {
  it('slot mutation inside an op body throws', () => {
    const world = createWorld();
    const s = world.slot(0);
    const impure = world.defineOp('impure', (ctx) => {
      s.set(1);
      return ctx.value('x', {});
    });
    expect(() => impure()).toThrow(/not allowed inside an operation body/);
  });

  it('collection mutation and timeline steps inside an op body throw', () => {
    const world = createWorld();
    const c = world.collection<number>();
    const impureAdd = world.defineOp('impureAdd', (ctx) => {
      c.add(1);
      return ctx.value('x', {});
    });
    const impureStep = world.defineOp('impureStep', (ctx) => {
      world.timeline.step('say', {});
      return ctx.value('x', {});
    });
    expect(() => impureAdd()).toThrow(/not allowed inside an operation body/);
    expect(() => impureStep()).toThrow(/not allowed inside an operation body/);
  });

  it('mutation during replay throws with a replay-specific message', () => {
    const world = createWorld();
    const s = world.slot(0);
    let first = true;
    const sneaky = world.defineOp('sneaky', (ctx) => {
      if (!first) s.set(1); // pure on the recorded run, impure on replay
      first = false;
      return ctx.value('x', {});
    });
    const v = sneaky();
    expect(() => world.trace(v)).toThrow(/during provenance replay/);
  });

  it('reading slots and collections inside an op body is allowed', () => {
    const world = createWorld();
    const s = world.slot(21);
    const op = world.defineOp('double', (ctx) => ctx.value('num', { n: s.peek() * 2 }));
    expect(op().n).toBe(42);
  });

  it('ctx.value preserves accessors — a live getter stays live, not a snapshot', () => {
    // The LinAlg.matrix pattern for op-created values: a graph edge whose
    // weight reads a Parameter must re-read it after a drag. A spread would
    // evaluate the getter once and freeze the number.
    const world = createWorld();
    const s = world.slot(5);
    const op = world.defineOp('edge.of', (ctx) =>
      ctx.value('edge', {
        get weight(): number {
          return s.value; // tracked read — derived sums over it re-run
        },
      }),
    );
    const e = op();
    expect(e.weight).toBe(5);
    const total = world.derived(() => e.weight * 2);
    expect(total.value).toBe(10);
    s.poke(9);
    expect(e.weight).toBe(9);
    expect(total.value).toBe(18);
    expect(world.provenanceOf(e)).toBeDefined(); // still a demonstrable value
  });
});
