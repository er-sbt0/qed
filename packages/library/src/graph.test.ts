/**
 * graph.test.ts — the graph library: derived nodes/edges with per-edge ink-in
 * traces, the traced deterministic walk (graph paths AND machine words — the
 * algebra probe's gap a), BFS whose visit order is the trace, Kruskal as a
 * traced process, live totalWeight, and the structure map's by-construction
 * maps-to edges with reported-not-thrown homomorphism diagnostics (gap b).
 */

import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { Handle, World } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import { createAutomata } from './automata.js';
import { createGraphLib } from './graph.js';
import type { GraphLib } from './graph.js';
import type { LabeledNumber } from './numeric.js';
import { createParameter } from './parameter.js';

function setup(): { world: World; Graph: GraphLib } {
  const world = createWorld();
  return { world, Graph: createGraphLib(world) };
}

/** The MST workhorse: 6 nodes, 9 weighted edges, tree cost 13. */
function network(Graph: GraphLib, weightBD: number | NumericHandle = 5) {
  return Graph.graph({
    nodes: ['A', 'B', 'C', 'D', 'E', 'F'],
    edges: [
      ['A', 'B', 4],
      ['A', 'C', 2],
      ['B', 'C', 1],
      ['B', 'D', weightBD],
      ['C', 'D', 8],
      ['C', 'E', 10],
      ['D', 'E', 2],
      ['D', 'F', 6],
      ['E', 'F', 3],
    ],
  });
}

const subjectId = (e: { readonly [key: string]: unknown }): string | undefined =>
  (e['subject'] as Handle | undefined)?.id;

describe('Graph.graph', () => {
  it('derives nodes and edges from labels, undirected by default', () => {
    const { Graph } = setup();
    const g = network(Graph);
    expect(g.kind).toBe('graph');
    expect(g.directed).toBe(false);
    expect(g.weighted).toBe(true);
    expect(g.nodes.map((n) => n.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(g.edges).toHaveLength(9);
    expect(g.edges[0]!.directed).toBe(false);
  });

  it('edge() matches either orientation when undirected, and throws listing edges', () => {
    const { Graph } = setup();
    const g = network(Graph);
    expect(g.edge('C', 'A').weight).toBe(2); // authored as A–C
    expect(g.edge(g.node('A'), g.node('C')).id).toBe(g.edge('C', 'A').id);
    expect(() => g.edge('A', 'F')).toThrow(/no edge A–F — edges: A–B/);
  });

  it('a directed graph respects orientation in edge() and neighbors()', () => {
    const { Graph } = setup();
    const g = Graph.graph({ nodes: ['x', 'y'], edges: [['x', 'y']], directed: true });
    expect(g.edge('x', 'y')).toBeDefined();
    expect(() => g.edge('y', 'x')).toThrow(/no edge y→x/);
    expect(g.neighbors('x').map((n) => n.label)).toEqual(['y']);
    expect(g.neighbors('y')).toEqual([]);
  });

  it('node() throws listing available labels; duplicate labels are rejected', () => {
    const { Graph } = setup();
    const g = network(Graph);
    expect(() => g.node('Z')).toThrow(/graph has no node labeled "Z" — available: A, B/);
    expect(() => Graph.graph({ nodes: ['A', 'A'], edges: [] })).toThrow(/duplicate node label/);
  });

  it('each edge carries an ink-in derivation, tagged with that edge', () => {
    const { world, Graph } = setup();
    const g = network(Graph);
    const events = world.trace(g);
    const derives = events.filter((e) => e.type === 'edge.derive');
    expect(derives).toHaveLength(9);
    // per-subpart demonstrate: exactly one event carries this edge's id
    const one = g.edge('B', 'C');
    expect(derives.filter((e) => subjectId(e) === one.id)).toHaveLength(1);
  });
});

describe('Graph.walk', () => {
  it('walks a graph path, one provenance-carrying value with hop events', () => {
    const { world, Graph } = setup();
    const g = network(Graph);
    const w = Graph.walk(g, { path: ['A', 'C', 'D', 'E'] });
    expect(w.kind).toBe('walk');
    expect(w.length).toBe(3);
    expect(w.landing.label).toBe('E');
    expect(w.path.map((n) => n.label)).toEqual(['A', 'C', 'D', 'E']);
    expect(w.edges.map((e) => e.id)).toEqual([
      g.edge('A', 'C').id,
      g.edge('C', 'D').id,
      g.edge('D', 'E').id,
    ]);
    const hops = world.trace(w).filter((e) => e.type === 'hop');
    expect(hops).toHaveLength(3);
    expect((hops[0]!['from'] as { label: string }).label).toBe('A');
    expect((hops[2]!['to'] as { label: string }).label).toBe('E');
    expect(hops[1]!['weight']).toBe(8); // C–D
  });

  it('rejects a step with no edge, naming the neighbors', () => {
    const { Graph } = setup();
    const g = network(Graph);
    expect(() => Graph.walk(g, { path: ['A', 'F'] })).toThrow(
      /no edge A–F — neighbors of A: B, C/,
    );
  });

  it('walks a StateMachine deterministically along a word — the probe gap', () => {
    const world = createWorld();
    const M = createAutomata(world);
    const Graph = createGraphLib(world);
    const Sigma = M.alphabet(['0', '1']);
    const words = M.enumerateWords(Sigma, { maxLength: 3 });
    const p = M.partition(words, {
      by: (w) => w.count('1') % 2,
      labels: { 0: 'EVEN', 1: 'ODD' },
    });
    const machine = M.stateMachine({
      statesFrom: p,
      alphabet: Sigma,
      transition: (cls, s) => p.classOf(cls.representative.append(s)),
      accepting: (cls) => cls.label === 'EVEN',
      initial: p.classOf(M.word('')),
    });

    const w = Graph.walk(machine, { word: '101' });
    expect(w.path.map((s) => s.label)).toEqual(['EVEN', 'ODD', 'ODD', 'EVEN']);
    expect(w.landing.label).toBe('EVEN');
    const hops = world.trace(w).filter((e) => e.type === 'hop');
    expect(hops.map((e) => e['symbol'])).toEqual(['1', '0', '1']);
    // each hop is tagged with the machine edge it rides
    expect(subjectId(hops[0]!)).toBe(machine.edge('EVEN', '1').id);
    // and an explicit start works too
    expect(Graph.walk(machine, { word: '1', from: 'ODD' }).landing.label).toBe('EVEN');
  });
});

describe('Graph.bfs', () => {
  it('visits in breadth-first order; the discovery hops are the trace', () => {
    const { world, Graph } = setup();
    const g = network(Graph);
    const t = Graph.bfs(g, { from: 'A' });
    expect(t.order.map((n) => n.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(t.tree).toHaveLength(5);
    expect(t.missed).toEqual([]);
    const events = world.trace(t);
    expect(events[0]!.type).toBe('visit');
    const hops = events.filter((e) => e.type === 'hop');
    expect(hops.map((e) => (e['to'] as { label: string }).label)).toEqual([
      'B',
      'C',
      'D',
      'E',
      'F',
    ]);
  });

  it('reports unreachable nodes instead of hiding them', () => {
    const { Graph } = setup();
    const g = Graph.graph({ nodes: ['a', 'b', 'c'], edges: [['a', 'b']] });
    const t = Graph.bfs(g, { from: 'a' });
    expect(t.missed.map((n) => n.label)).toEqual(['c']);
  });
});

describe('Graph.minSpanningTree (Kruskal)', () => {
  it('accepts the cheapest edges in weight order and skips cycle-closers', () => {
    const { Graph } = setup();
    const g = network(Graph);
    const tree = Graph.minSpanningTree(g);
    expect(tree.spanning).toBe(true);
    expect(tree.edges.map((e) => `${e.from.label}${e.to.label}`)).toEqual([
      'BC',
      'AC',
      'DE',
      'EF',
      'BD',
    ]);
    expect(tree.skipped.map((e) => `${e.from.label}${e.to.label}`)).toEqual([
      'AB',
      'DF',
      'CD',
      'CE',
    ]);
    expect(tree.totalWeight.value).toBe(13);
  });

  it('is a traced process: accepted edges ink in, rejected ones only pulse', () => {
    const { world, Graph } = setup();
    const g = network(Graph);
    const tree = Graph.minSpanningTree(g);
    const events = world.trace(tree);
    expect(events.map((e) => e.type)).toEqual([
      'tree.derive', // BC 1
      'tree.derive', // AC 2
      'tree.derive', // DE 2
      'tree.derive', // EF 3
      'skip', //        AB 4 closes a cycle
      'tree.derive', // BD 5
      'skip', //        DF 6
      'skip', //        CD 8
      'skip', //        CE 10
    ]);
    const first = events[0]!;
    expect(subjectId(first)).toBe(g.edge('B', 'C').id);
    expect(first['weight']).toBe(1);
    // skip events carry no endpoints — a rejected edge must not "travel"
    const skip = events.find((e) => e.type === 'skip')!;
    expect(skip['from']).toBeUndefined();
    expect(skip['to']).toBeUndefined();
  });

  it('a disconnected graph yields a forest and says so', () => {
    const { Graph } = setup();
    const g = Graph.graph({
      nodes: ['a', 'b', 'c', 'd'],
      edges: [
        ['a', 'b', 1],
        ['c', 'd', 2],
      ],
    });
    const tree = Graph.minSpanningTree(g);
    expect(tree.spanning).toBe(false);
    expect(tree.edges).toHaveLength(2);
  });
});

describe('Graph.totalWeight', () => {
  it('is a live NumericHandle over any edge selection', () => {
    const { Graph } = setup();
    const g = network(Graph);
    const picked = Graph.totalWeight([g.edge('A', 'B'), g.edge('E', 'F')], 'picked');
    expect(picked.kind).toBe('scalar');
    expect(picked.value).toBe(7);
    expect((picked as LabeledNumber).label).toBe('picked');
  });
});

describe('reactive weights (number | NumericHandle at construction)', () => {
  it('a Parameter-weighted edge reads its weight LIVE, clamped by the range', () => {
    const { world, Graph } = setup();
    const price = createParameter(world, 'price', 5, [1, 10]);
    const g = network(Graph, price);
    expect(g.weighted).toBe(true);
    expect(g.edge('B', 'D').weight).toBe(5);
    price.setValueLive(9);
    expect(g.edge('B', 'D').weight).toBe(9);
    price.setValueLive(99); // the object's policy: the drag cannot leave the range
    expect(g.edge('B', 'D').weight).toBe(10);
  });

  it('totalWeight re-sums under setValueLive, with no timeline step (drag path)', () => {
    const { world, Graph } = setup();
    const price = createParameter(world, 'price', 5, [1, 10]);
    const g = network(Graph, price);
    const picked = Graph.totalWeight([g.edge('B', 'D'), g.edge('E', 'F')]);
    expect(picked.value).toBe(8);
    const steps = world.timeline.root.length;
    price.setValueLive(7);
    expect(picked.value).toBe(10);
    expect(world.timeline.root.length).toBe(steps); // a drag frame is not a beat
  });

  it('minSpanningTree SNAPSHOTS: a later drag moves neither its edges nor its total', () => {
    const { world, Graph } = setup();
    const price = createParameter(world, 'price', 5, [1, 10]);
    const g = network(Graph, price);
    const tree = Graph.minSpanningTree(g);
    expect(tree.edges.map((e) => `${e.from.label}${e.to.label}`)).toContain('BD');
    expect(tree.totalWeight.value).toBe(13);
    price.setValueLive(9); // BD is now costlier than its rival CD at 8
    // the traced record does not drift — same edge set, same total
    expect(tree.edges.map((e) => `${e.from.label}${e.to.label}`)).toContain('BD');
    expect(tree.totalWeight.value).toBe(13);
  });

  it('spanningTreeLive re-derives: the tree flips where the numbers cross', () => {
    const { world, Graph } = setup();
    const price = createParameter(world, 'price', 5, [1, 10]);
    const g = network(Graph, price);
    const live = Graph.spanningTreeLive(g);
    const bd = g.edge('B', 'D');
    const cd = g.edge('C', 'D');

    // at 5 the live tree agrees with the traced one
    expect(live.edges.map((e) => `${e.from.label}${e.to.label}`)).toEqual(
      Graph.minSpanningTree(g).edges.map((e) => `${e.from.label}${e.to.label}`),
    );
    expect(live.inTree(bd)).toBe(true);
    expect(live.inTree(cd)).toBe(false);
    expect(live.totalWeight.value).toBe(13);
    expect(live.spanning).toBe(true);

    // drag past the rival: membership, edge set and total all flip — no
    // authored threshold anywhere, the flip falls out of cheapest-first
    price.setValueLive(9);
    expect(live.inTree(bd)).toBe(false);
    expect(live.inTree(cd)).toBe(true);
    expect(live.edges.map((e) => `${e.from.label}${e.to.label}`)).toEqual([
      'BC',
      'AC',
      'DE',
      'EF',
      'CD',
    ]);
    expect(live.totalWeight.value).toBe(16);

    // and back
    price.setValueLive(5);
    expect(live.inTree(bd)).toBe(true);
    expect(live.totalWeight.value).toBe(13);
  });
});

describe('Graph.structureMap', () => {
  it('records per-node and per-edge maps-to correspondence by construction', () => {
    const { world, Graph } = setup();
    const g = network(Graph);
    const sides = Graph.graph({
      nodes: ['west', 'east'],
      edges: [
        ['west', 'west'],
        ['west', 'east'],
        ['east', 'east'],
      ],
    });
    const cut = Graph.structureMap({
      from: g,
      to: sides,
      nodes: { A: 'west', B: 'west', C: 'west', D: 'east', E: 'east', F: 'east' },
    });
    expect(cut.diagnostics).toEqual([]);
    expect(cut.pairs).toHaveLength(6);
    expect(cut.image('D').label).toBe('east');
    expect(() => cut.image('Z')).toThrow(/no image for "Z" — mapped: A, B/);

    // node → image edge
    const aEdges = world.graph.edgesOf(g.node('A'));
    expect(
      aEdges.some((e) => e.rel === 'maps-to' && e.b.id === sides.node('west').id),
    ).toBe(true);
    // crossing edge → the bridge; within-side edge → the side's self-loop
    const bridge = sides.edge('west', 'east');
    expect(
      world.graph.edgesOf(g.edge('B', 'D')).some((e) => e.rel === 'maps-to' && e.b.id === bridge.id),
    ).toBe(true);
    const westLoop = sides.edge('west', 'west');
    expect(
      world.graph.edgesOf(g.edge('A', 'B')).some((e) => e.rel === 'maps-to' && e.b.id === westLoop.id),
    ).toBe(true);
  });

  it('reports non-homomorphic mappings as diagnostics, never a throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { Graph } = setup();
      const g = Graph.graph({ nodes: ['a', 'b'], edges: [['a', 'b']] });
      const h = Graph.graph({ nodes: ['x', 'y'], edges: [] });
      const map = Graph.structureMap({ from: g, to: h, nodes: { a: 'x', b: 'y' } });
      const bad = map.diagnostics.filter((d) => d.kind === 'not-a-homomorphism');
      expect(bad).toHaveLength(1);
      expect(bad[0]!.message).toMatch(/edges must map to edges/);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('flags unknown and unmapped nodes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { Graph } = setup();
      const g = Graph.graph({ nodes: ['a', 'b'], edges: [] });
      const h = Graph.graph({ nodes: ['x'], edges: [] });
      const map = Graph.structureMap({ from: g, to: h, nodes: { a: 'nope' } });
      expect(map.diagnostics.map((d) => d.kind).sort()).toEqual([
        'missing-image', // a's image was unknown, so a ends up unmapped
        'missing-image', // b was never mapped
        'unknown-node',
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('maps machine to machine, matching symbols along edges', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const world = createWorld();
      const M = createAutomata(world);
      const Graph = createGraphLib(world);
      const Sigma = M.alphabet(['1']);
      const words = M.enumerateWords(Sigma, { maxLength: 4 });
      // count mod 4 → count mod 2: the quotient map Z4 → Z2
      const p4 = M.partition(words, { by: (w) => w.count('1') % 4 });
      const p2 = M.partition(words, { by: (w) => w.count('1') % 2 });
      const mk = (p: typeof p4) =>
        M.stateMachine({
          statesFrom: p,
          alphabet: Sigma,
          transition: (cls, s) => p.classOf(cls.representative.append(s)),
          accepting: (cls) => cls.label === '0',
          initial: p.classOf(M.word('')),
        });
      const m4 = mk(p4);
      const m2 = mk(p2);
      const q = Graph.structureMap({
        from: m4,
        to: m2,
        nodes: { 0: '0', 1: '1', 2: '0', 3: '1' },
      });
      expect(q.diagnostics).toEqual([]);
      // the projected edge exists with the SAME symbol: 2 --1→ 3 maps to 0 --1→ 1
      const projected = world.graph.edgesOf(m4.edge('2', '1'));
      expect(
        projected.some((e) => e.rel === 'maps-to' && e.b.id === m2.edge('0', '1').id),
      ).toBe(true);
      // a wrong quotient is DIAGNOSED: send 1 ↦ 0 and edges stop mapping to edges
      const wrong = Graph.structureMap({
        from: m4,
        to: m2,
        nodes: { 0: '0', 1: '0', 2: '0', 3: '1' },
      });
      expect(wrong.diagnostics.some((d) => d.kind === 'not-a-homomorphism')).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
