import { describe, expect, it } from 'vitest';
import { CorrespondenceGraph } from './correspondence.js';
import { IdRegistry } from './identity.js';
import { createWorld } from './world.js';

const reg = () => new IdRegistry();

describe('recording and authoring', () => {
  it('link records a single authored edge', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('word');
    const b = ids.handle('span');
    const [edge] = g.link(a, b, 'represents');
    expect(edge).toMatchObject({ a, b, rel: 'represents', origin: 'authored' });
    expect(g.edges).toHaveLength(1);
  });

  it('link fans out over an array of targets', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const span = ids.handle('span');
    const words = [ids.handle('word'), ids.handle('word'), ids.handle('word')];
    const edges = g.link(span, words, 'represents');
    expect(edges).toHaveLength(3);
    expect(g.edgesOf(span)).toHaveLength(3);
  });

  it('dedupes identical (a, b, rel) triples to the first edge', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('class');
    const b = ids.handle('state');
    const [first] = g.link(a, b, 'counterpart-of');
    const again = g.record(a, b, 'counterpart-of', 'construction');
    expect(again).toBe(first);
    expect(g.edges).toHaveLength(1);
    // a different relation between the same pair is a distinct edge
    g.record(a, b, 'came-from', 'construction');
    expect(g.edges).toHaveLength(2);
  });

  it('edgesOf indexes both endpoints', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('class');
    const b = ids.handle('state');
    g.link(a, b, 'counterpart-of');
    expect(g.edgesOf(a)).toHaveLength(1);
    expect(g.edgesOf(b)).toHaveLength(1);
    expect(g.edgesOf('nonexistent')).toHaveLength(0);
  });

  it('neighbors returns distinct adjacent handles, optionally filtered by relation', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('class');
    const b = ids.handle('state');
    const c = ids.handle('span');
    g.link(a, b, 'counterpart-of');
    g.link(a, b, 'maps-to');
    g.link(c, a, 'represents');
    expect(g.neighbors(a).map((h) => h.id).sort()).toEqual([b.id, c.id].sort());
    expect(g.neighbors(a, { rels: ['represents'] }).map((h) => h.id)).toEqual([c.id]);
  });
});

describe('reachability', () => {
  it('a handle reaches itself with an empty path', () => {
    const g = new CorrespondenceGraph();
    const a = reg().handle('word');
    expect(g.reachable(a, a)).toBe(true);
    expect(g.path(a, a)).toEqual([]);
  });

  it('direct edges are reachable in both directions', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('class');
    const b = ids.handle('state');
    g.link(a, b, 'counterpart-of');
    expect(g.reachable(a, b)).toBe(true);
    expect(g.reachable(b, a)).toBe(true);
  });

  it('unrelated handles are not reachable', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('word');
    const b = ids.handle('state');
    g.link(a, ids.handle('span'), 'represents');
    expect(g.reachable(a, b)).toBe(false);
    expect(g.path(a, b)).toBeUndefined();
  });

  it('multi-hop paths are found and returned in order', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const w = ids.handle('word');
    const cls = ids.handle('class');
    const state = ids.handle('state');
    const node = ids.handle('view:node');
    g.link(w, cls, 'contributes-to');
    g.link(cls, state, 'counterpart-of');
    g.link(node, state, 'represents'); // reversed authoring direction on purpose
    const path = g.path(w, node);
    expect(path).toBeDefined();
    expect(path!.map((e) => e.rel)).toEqual(['contributes-to', 'counterpart-of', 'represents']);
  });

  it('rels filter constrains traversal', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('a');
    const b = ids.handle('b');
    const c = ids.handle('c');
    g.link(a, b, 'came-from');
    g.link(b, c, 'represents');
    expect(g.reachable(a, c)).toBe(true);
    expect(g.reachable(a, c, { rels: ['came-from'] })).toBe(false);
    expect(g.reachable(a, c, { rels: ['came-from', 'represents'] })).toBe(true);
  });

  it('maxDepth bounds the search', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const chain = [ids.handle('n'), ids.handle('n'), ids.handle('n'), ids.handle('n')];
    for (let i = 0; i < chain.length - 1; i += 1) {
      g.link(chain[i]!, chain[i + 1]!, 'maps-to');
    }
    expect(g.reachable(chain[0]!, chain[3]!, { maxDepth: 2 })).toBe(false);
    expect(g.reachable(chain[0]!, chain[3]!, { maxDepth: 3 })).toBe(true);
  });

  it('path is shortest by hop count', () => {
    const g = new CorrespondenceGraph();
    const ids = reg();
    const a = ids.handle('n');
    const b = ids.handle('n');
    const c = ids.handle('n');
    // long way round: a -> b -> c ; short way: a -> c
    g.link(a, b, 'maps-to');
    g.link(b, c, 'maps-to');
    g.link(a, c, 'represents');
    expect(g.path(a, c)).toHaveLength(1);
  });
});

describe('multi-hop reachability across a derivation chain', () => {
  it('mixes by-construction (auto came-from), op-recorded, and authored edges', () => {
    const world = createWorld();
    // derivation: append mints a new word; auto came-from edges to handle inputs
    const append = world.defineOp(
      'word.append',
      (ctx, base: { id: string; kind: string; text: string }, suffix: string) =>
        ctx.value('word', { text: base.text + suffix }),
    );
    const x = world.defineOp('word.of', (ctx, text: string) => ctx.value('word', { text }))('0');
    const xz = append(x, '1'); // xz --came-from--> x (by construction)

    // a second derivation records counterpart-of via ctx.link
    const classify = world.defineOp('classify', (ctx, w: typeof xz) => {
      const cls = ctx.value('class', { label: 'ODD' });
      ctx.link(cls, w, 'counterpart-of');
      return cls;
    });
    const cls = classify(xz);

    // an authored edge completes the chain
    const node = world.handle('view:node');
    world.link(node, cls, 'represents');

    // x --(came-from)-- xz --(counterpart-of)-- cls --(represents)-- node
    expect(world.graph.reachable(x, node)).toBe(true);
    const path = world.graph.path(x, node);
    expect(path!.map((e) => e.origin)).toEqual(['construction', 'construction', 'authored']);
  });
});
