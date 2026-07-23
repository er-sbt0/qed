/**
 * graph.ts — the graph discipline library, in USERLAND over `@math-ai/core`:
 * docs/object-layer.md step 3, the first real extraction. `StateMachine`
 * generalized — nodes and edges as handles, no alphabet, optionally undirected,
 * optionally weighted — plus the traced operations the algebra probe found
 * missing (docs/probe-algebra.md):
 *
 *   - `graph(...)` derives nodes/edges from label lists and emits one
 *     `edge.derive` trace event per edge tagged with that edge's handle, so
 *     `demonstrate(g)` inks the whole graph in edge by edge and
 *     `demonstrate(oneEdge)` inks exactly one — the same contract machine
 *     edges already had.
 *   - `walk(...)` is the TRACED DETERMINISTIC WALK (probe gap a): one
 *     provenance-carrying value whose hop events replay the path. It walks a
 *     `Graph` along node labels, or a `StateMachine` along a word — the walk
 *     the dihedral example had to fake with a 9-line macro.
 *   - `bfs(...)` is a traversal whose visit order IS the trace: a hop per
 *     discovery, along the tree edge that discovered the node.
 *   - `minSpanningTree(...)` is Kruskal as a traced process: edges considered
 *     in weight order, accepted ones emitting `tree.derive` (the ink-in cue),
 *     rejected ones a subject-only `skip` (a pulse). Components are an
 *     internal union-find — NOT `M.partition`, deliberately: a partition's
 *     `by` key is fixed at construction, while Kruskal's components merge per
 *     accepted edge. See docs/probe-graphs.md.
 *   - `spanningTreeLive(...)` is the REACTIVE stance on the same mathematics
 *     (the `Prob.stationary` pattern): a `world.derived` re-runs Kruskal over
 *     TRACKED weight reads, so dragging a Parameter-weighted edge flips which
 *     edges are in the tree with zero authoring. The two stances are both
 *     honest and deliberately separate — `minSpanningTree` SNAPSHOTS (its
 *     trace is a replayable derivation and must not drift under a later drag,
 *     the `Calc.riemann` policy), `spanningTreeLive` re-reads on every access
 *     (what a view's `applyState()` paints).
 *
 * Weights are `number | NumericHandle` at construction (the `LinAlg.matrix`
 * entry pattern): an edge authored with an `M.parameter` weight exposes it as
 * a LIVE `weight` getter, so `Graph.totalWeight` and `spanningTreeLive` track
 * it and a drag moves everything downstream.
 *   - `structureMap(...)` is the arrow BETWEEN two structures (probe gap b):
 *     per-node (and per-determined-edge) `maps-to` edges recorded by
 *     construction, the way `LinAlg.LinearMap.apply` records per-vertex edges
 *     — which is what makes `morph(graphViewA, graphViewB)` legal and routes
 *     it. Non-homomorphic mappings become DIAGNOSTICS, never a throw, in the
 *     exact `stateMachine` style.
 *
 * Label lookups throw listing what exists, via the shared `structure.ts` core
 * extracted from automata.ts.
 */

import type { Handle, OpContext, World } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import { constNumber, derivedNumber } from './numeric.js';
import { byLabel, findOr, reportDiagnostics } from './structure.js';
import type { MachineEdge, StateMachine } from './automata.js';

// ─────────────────────────────── types ───────────────────────────────

export interface GraphNode extends Handle<'node'> {
  readonly label: string;
}

export interface GraphEdge extends Handle<'edge'> {
  readonly from: GraphNode;
  readonly to: GraphNode;
  /**
   * Present iff the edge was authored with a weight. LIVE when the weight was
   * authored as a NumericHandle (an `M.parameter`): reading it re-reads the
   * handle, tracked, so reactive numerics over it follow a drag.
   */
  readonly weight?: number;
  readonly directed: boolean;
}

/**
 * `["A","B"]` or `["A","B", 4]` or `["A","B", price]` — endpoints by node
 * label, optional weight, literal or a live NumericHandle (a Parameter).
 */
export type EdgeSpec =
  | readonly [string, string]
  | readonly [string, string, number | NumericHandle];

export interface Graph extends Handle<'graph'> {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly directed: boolean;
  /** True iff any edge carries a weight. */
  readonly weighted: boolean;
  node(label: string): GraphNode;
  /** The edge between two nodes (either orientation when undirected). */
  edge(a: string | GraphNode, b: string | GraphNode): GraphEdge;
  /** Nodes one edge away (successors only, when directed). Insertion order. */
  neighbors(of: string | GraphNode): readonly GraphNode[];
}

/** A node-like stop on a walk: a GraphNode or a MachineState. */
export interface Labeled extends Handle {
  readonly label: string;
}

export interface GraphWalk extends Handle<'walk'> {
  readonly path: readonly Labeled[];
  readonly edges: ReadonlyArray<GraphEdge | MachineEdge>;
  readonly landing: Labeled;
  readonly length: number;
}

export interface Traversal extends Handle<'traversal'> {
  readonly root: GraphNode;
  /** Visit order — the trace replays one hop per discovery. */
  readonly order: readonly GraphNode[];
  /** The discovery (BFS tree) edges, in discovery order. */
  readonly tree: readonly GraphEdge[];
  /** Nodes the traversal never reached (empty iff connected from root). */
  readonly missed: readonly GraphNode[];
}

export interface SpanningTree extends Handle<'tree'> {
  readonly of: Graph;
  /** Accepted edges, in acceptance (weight) order. */
  readonly edges: readonly GraphEdge[];
  /** Edges considered and rejected (they would close a cycle), in order. */
  readonly skipped: readonly GraphEdge[];
  /**
   * Total of the accepted edges' weights, SNAPSHOTTED at derive time — the
   * traced tree is a record of the run that was demonstrated, so its total
   * must not drift when a weight is dragged later. For the total that follows
   * a drag, use `spanningTreeLive(g).totalWeight`.
   */
  readonly totalWeight: NumericHandle;
  /** True iff the tree reaches every node (false ⇒ a spanning forest). */
  readonly spanning: boolean;
}

/**
 * The REACTIVE spanning tree: the same Kruskal, re-derived from the CURRENT
 * weights on every read (the `Prob.stationary` pattern). Not a traced value —
 * there is no single derivation to replay, because it re-derives; demonstrate
 * the traced `minSpanningTree` result instead, then hand this one to the view
 * (`View.graph(g, { tree })`) and the readout for the live story.
 */
export interface LiveSpanningTree extends Handle<'tree:live'> {
  readonly of: Graph;
  /** The current cheapest spanning edge set — recomputed on read. */
  readonly edges: readonly GraphEdge[];
  /** Live total of the current tree — moves while a weight is dragged. */
  readonly totalWeight: NumericHandle;
  /** True iff the current tree reaches every node. */
  readonly spanning: boolean;
  /** Live membership: is this edge in the current tree? */
  inTree(edge: GraphEdge): boolean;
}

/** A coherence problem found while deriving a map. Reported, never thrown. */
export interface MapDiagnostic {
  readonly kind: 'unknown-node' | 'missing-image' | 'not-a-homomorphism';
  readonly message: string;
}

export interface StructureMap extends Handle<'structmap'> {
  readonly from: Graph | StateMachine;
  readonly to: Graph | StateMachine;
  /** The node pairs, in `from`-node order: [node, its image]. */
  readonly pairs: ReadonlyArray<readonly [Labeled, Labeled]>;
  readonly diagnostics: readonly MapDiagnostic[];
  /** The image of a `from` node, by label. Throws listing mapped labels. */
  image(label: string): Labeled;
}

export interface GraphLib {
  graph(opts: {
    readonly nodes: readonly string[];
    readonly edges: readonly EdgeSpec[];
    /** Default false — an edge joins, it does not point. */
    readonly directed?: boolean;
  }): Graph;
  walk(subject: Graph, opts: { readonly path: readonly string[] }): GraphWalk;
  walk(subject: StateMachine, opts: { readonly word: string; readonly from?: string }): GraphWalk;
  bfs(g: Graph, opts: { readonly from: string }): Traversal;
  minSpanningTree(g: Graph): SpanningTree;
  /** The reactive stance: re-derived from current weights on every read. */
  spanningTreeLive(g: Graph): LiveSpanningTree;
  /** Live total weight of any edge set (compare candidate selections). Reads
   *  weights TRACKED, so a Parameter-weighted edge re-sums under drag. */
  totalWeight(edges: readonly GraphEdge[], label?: string): NumericHandle;
  structureMap(opts: {
    readonly from: Graph | StateMachine;
    readonly to: Graph | StateMachine;
    /** from-node label → to-node label. */
    readonly nodes: Readonly<Record<string, string>>;
  }): StructureMap;
}

// ───────────────────────────── helpers ─────────────────────────────

interface WalkSpec {
  readonly path?: readonly string[];
  readonly word?: string;
  readonly from?: string;
}

function isGraph(subject: Graph | StateMachine): subject is Graph {
  return subject.kind === 'graph';
}

/** Uniform node/edge access over the two structures a map can join. */
function nodesOf(s: Graph | StateMachine): readonly Labeled[] {
  return isGraph(s) ? s.nodes : s.states;
}
function edgesOf(s: Graph | StateMachine): ReadonlyArray<GraphEdge | MachineEdge> {
  return s.edges;
}

function edgeName(e: GraphEdge): string {
  return `${e.from.label}${e.directed ? '→' : '–'}${e.to.label}`;
}

function sumWeights(edges: readonly GraphEdge[]): number {
  let total = 0;
  for (const e of edges) total += e.weight ?? 0;
  return total;
}

interface KruskalDecision {
  readonly edge: GraphEdge;
  /** The weight AS READ for this run — the traced op's trace events reuse it. */
  readonly weight: number | undefined;
  readonly accepted: boolean;
}

interface KruskalRun {
  readonly decisions: readonly KruskalDecision[];
  readonly spanning: boolean;
}

/**
 * Kruskal's consideration sequence, shared by the two stances. Components are
 * a union-find, not `M.partition` (see docs/probe-graphs.md). Stable order —
 * by weight, then authoring order — so replay is deterministic. Reads each
 * edge's weight exactly once per run: a plain snapshot inside the traced op,
 * a TRACKED read when run inside `spanningTreeLive`'s derived.
 */
function runKruskal(g: Graph): KruskalRun {
  const parent = new Map<string, string>(g.nodes.map((n) => [n.id, n.id]));
  const find = (id: string): string => {
    let at = id;
    while (parent.get(at) !== at) at = parent.get(at)!;
    return at;
  };
  const ordered = g.edges
    .map((e, i) => ({ e, i, w: e.weight }))
    .sort((a, b) => (a.w ?? 0) - (b.w ?? 0) || a.i - b.i);
  const decisions: KruskalDecision[] = [];
  for (const { e, w } of ordered) {
    const ra = find(e.from.id);
    const rb = find(e.to.id);
    if (ra === rb) {
      decisions.push({ edge: e, weight: w, accepted: false });
      continue;
    }
    parent.set(ra, rb);
    decisions.push({ edge: e, weight: w, accepted: true });
  }
  const roots = new Set(g.nodes.map((n) => find(n.id)));
  return { decisions: Object.freeze(decisions), spanning: roots.size <= 1 };
}

// ───────────────────────────── factory ─────────────────────────────

export function createGraphLib(world: World): GraphLib {
  // ─────────────────────────────── graph ───────────────────────────────

  const graphOp = world.defineOp(
    'Graph.graph',
    (
      ctx,
      nodeLabels: readonly string[],
      edgeSpecs: readonly EdgeSpec[],
      directed: boolean,
    ): Graph => {
      const seen = new Set<string>();
      for (const label of nodeLabels) {
        if (seen.has(label)) {
          throw new Error(`Graph.graph: duplicate node label "${label}" — labels must be unique`);
        }
        seen.add(label);
      }
      const nodes: GraphNode[] = nodeLabels.map((label) => ctx.value('node', { label }));
      const node = (label: string): GraphNode => byLabel(nodes, label, 'graph has no node');

      const edges: GraphEdge[] = [];
      for (const spec of edgeSpecs) {
        const [a, b, weight] = spec;
        const ends = { from: node(a), to: node(b), directed };
        const edge: GraphEdge =
          weight === undefined
            ? ctx.value('edge', ends)
            : typeof weight === 'number'
              ? ctx.value('edge', { ...ends, weight })
              : // a LIVE weight: the getter survives ctx.value (descriptors are
                // preserved), so reading it is a tracked read of the handle
                ctx.value('edge', {
                  ...ends,
                  get weight(): number {
                    return weight.value;
                  },
                });
        // the edge's ink-in cue, tagged with the edge itself: demonstrate(g)
        // reveals them one at a time, demonstrate(edge) exactly one
        ctx.trace({ type: 'edge.derive', subject: edge, from: edge.from, to: edge.to });
        edges.push(edge);
      }

      const labelOf = (which: string | GraphNode): string =>
        typeof which === 'string' ? which : which.label;
      const joins = (e: GraphEdge, a: string, b: string): boolean =>
        (e.from.label === a && e.to.label === b) ||
        (!directed && e.from.label === b && e.to.label === a);

      const g = ctx.value(
        'graph',
        {
          nodes: Object.freeze([...nodes]),
          edges: Object.freeze([...edges]),
          directed,
          weighted: edges.some((e) => e.weight !== undefined),
          node,
          edge(a: string | GraphNode, b: string | GraphNode): GraphEdge {
            const la = labelOf(a);
            const lb = labelOf(b);
            return findOr(
              edges,
              (e) => joins(e, la, lb),
              () =>
                `graph has no edge ${la}${directed ? '→' : '–'}${lb} — edges: ` +
                (edges.map(edgeName).join(', ') || '(none)'),
            );
          },
          neighbors(of: string | GraphNode): readonly GraphNode[] {
            const at = node(labelOf(of));
            const out: GraphNode[] = [];
            for (const e of edges) {
              if (e.from.id === at.id && !out.some((n) => n.id === e.to.id)) out.push(e.to);
              else if (!directed && e.to.id === at.id && !out.some((n) => n.id === e.from.id)) {
                out.push(e.from);
              }
            }
            return out;
          },
        },
      );
      return g as Graph;
    },
  );

  // ─────────────────────────────── walk ───────────────────────────────

  const walkGraph = (ctx: OpContext, g: Graph, path: readonly string[]): GraphWalk => {
    if (path.length === 0) {
      throw new Error('Graph.walk: path must name at least the starting node');
    }
    let at = g.node(path[0]!);
    const stops: Labeled[] = [at];
    const hops: GraphEdge[] = [];
    for (let i = 1; i < path.length; i += 1) {
      const next = g.node(path[i]!);
      const here = at;
      const edge = findOr(
        g.edges,
        (e) =>
          (e.from.id === here.id && e.to.id === next.id) ||
          (!g.directed && e.to.id === here.id && e.from.id === next.id),
        () =>
          `Graph.walk: no edge ${here.label}${g.directed ? '→' : '–'}${next.label} — ` +
          `neighbors of ${here.label}: ` +
          (g.neighbors(here).map((n) => n.label).join(', ') || '(none)'),
      );
      ctx.trace(
        edge.weight === undefined
          ? { type: 'hop', subject: edge, from: here, to: next, index: i - 1 }
          : { type: 'hop', subject: edge, from: here, to: next, index: i - 1, weight: edge.weight },
      );
      hops.push(edge);
      stops.push(next);
      at = next;
    }
    return ctx.value('walk', {
      path: Object.freeze(stops),
      edges: Object.freeze(hops),
      landing: at,
      length: hops.length,
    });
  };

  const walkMachine = (
    ctx: OpContext,
    machine: StateMachine,
    word: string,
    from: string | undefined,
  ): GraphWalk => {
    let at = from === undefined ? machine.initial : machine.state(from);
    const stops: Labeled[] = [at];
    const hops: MachineEdge[] = [];
    let i = 0;
    for (const symbol of word) {
      const edge = machine.edge(at.label, symbol); // throws listing the miss
      ctx.trace({ type: 'hop', subject: edge, from: at, to: edge.to, symbol, index: i });
      hops.push(edge);
      stops.push(edge.to);
      at = edge.to;
      i += 1;
    }
    return ctx.value('walk', {
      path: Object.freeze(stops),
      edges: Object.freeze(hops),
      landing: at,
      length: hops.length,
    });
  };

  const walkOp = world.defineOp(
    'Graph.walk',
    (ctx, subject: Graph | StateMachine, spec: WalkSpec): GraphWalk => {
      if (isGraph(subject)) {
        if (!spec.path) {
          throw new Error('Graph.walk(graph, ...) needs { path: ["A", "B", ...] } — node labels in order');
        }
        return walkGraph(ctx, subject, spec.path);
      }
      if (spec.word === undefined) {
        throw new Error('Graph.walk(machine, ...) needs { word: "..." } — one symbol per step');
      }
      return walkMachine(ctx, subject, spec.word, spec.from);
    },
  );

  // ─────────────────────────────── bfs ───────────────────────────────

  const bfsOp = world.defineOp('Graph.bfs', (ctx, g: Graph, from: string): Traversal => {
    const root = g.node(from);
    ctx.trace({ type: 'visit', subject: root });
    const seen = new Set<string>([root.id]);
    const order: GraphNode[] = [root];
    const tree: GraphEdge[] = [];
    const queue: GraphNode[] = [root];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const e of g.edges) {
        let next: GraphNode | null = null;
        if (e.from.id === at.id) next = e.to;
        else if (!g.directed && e.to.id === at.id) next = e.from;
        if (!next || seen.has(next.id)) continue;
        seen.add(next.id);
        ctx.trace({ type: 'hop', subject: e, from: at, to: next });
        order.push(next);
        tree.push(e);
        queue.push(next);
      }
    }
    const missed = g.nodes.filter((n) => !seen.has(n.id));
    return ctx.value('traversal', {
      root,
      order: Object.freeze(order),
      tree: Object.freeze(tree),
      missed: Object.freeze(missed),
    });
  });

  // ─────────────────────────── spanning tree ───────────────────────────

  const mstOp = world.defineOp('Graph.minSpanningTree', (ctx, g: Graph): SpanningTree => {
    // The TRACED stance: one Kruskal run, weights read (snapshotted) here.
    // Its trace is a replayable derivation, so nothing on the result may
    // silently drift when a Parameter weight is dragged later — the same
    // policy as Calc.riemann snapshotting its Parameter `to`. The reactive
    // stance is spanningTreeLive below.
    const run = runKruskal(g);
    const accepted: GraphEdge[] = [];
    const skipped: GraphEdge[] = [];
    let total = 0;
    for (const { edge: e, weight, accepted: keep } of run.decisions) {
      if (!keep) {
        // subject only, no endpoints: a rejected edge pulses, it never travels
        ctx.trace({ type: 'skip', subject: e });
        skipped.push(e);
        continue;
      }
      ctx.trace(
        weight === undefined
          ? { type: 'tree.derive', subject: e, from: e.from, to: e.to }
          : { type: 'tree.derive', subject: e, from: e.from, to: e.to, weight },
      );
      accepted.push(e);
      total += weight ?? 0;
    }
    return ctx.value('tree', {
      of: g,
      edges: Object.freeze([...accepted]),
      skipped: Object.freeze([...skipped]),
      totalWeight: constNumber(world, total, 'total weight'),
      spanning: run.spanning,
    });
  });

  // ───────────────────────── live spanning tree ─────────────────────────

  /**
   * The REACTIVE stance (the `Prob.stationary` shape): one `world.derived`
   * re-runs Kruskal whenever a tracked weight it read has moved. Dragging a
   * Parameter-weighted edge therefore flips membership, edge set and total
   * with zero authoring — the flip falls out of the numbers.
   */
  const spanningTreeLive = (g: Graph): LiveSpanningTree => {
    const derived = world.derived(() => {
      const run = runKruskal(g); // every e.weight read in here is TRACKED
      const edges: GraphEdge[] = [];
      const ids = new Set<string>();
      let total = 0;
      for (const d of run.decisions) {
        if (!d.accepted) continue;
        edges.push(d.edge);
        ids.add(d.edge.id);
        total += d.weight ?? 0;
      }
      return Object.freeze({ edges: Object.freeze(edges), ids, total, spanning: run.spanning });
    });
    const base = world.handle('tree:live');
    return Object.freeze({
      id: base.id,
      kind: 'tree:live' as const,
      of: g,
      get edges(): readonly GraphEdge[] {
        return derived.value.edges;
      },
      get spanning(): boolean {
        return derived.value.spanning;
      },
      totalWeight: derivedNumber(world, () => derived.value.total, 'total weight'),
      inTree: (edge: GraphEdge): boolean => derived.value.ids.has(edge.id),
    });
  };

  // ─────────────────────────── structure map ───────────────────────────

  const mapOp = world.defineOp(
    'Graph.structureMap',
    (
      ctx,
      from: Graph | StateMachine,
      to: Graph | StateMachine,
      assignment: Readonly<Record<string, string>>,
    ): StructureMap => {
      const fromNodes = nodesOf(from);
      const toNodes = nodesOf(to);
      const diagnostics: MapDiagnostic[] = [];
      const imageByLabel = new Map<string, Labeled>();
      const pairs: Array<readonly [Labeled, Labeled]> = [];

      for (const [label, imageLabel] of Object.entries(assignment)) {
        const source = fromNodes.find((n) => n.label === label);
        const image = toNodes.find((n) => n.label === imageLabel);
        if (!source || !image) {
          diagnostics.push({
            kind: 'unknown-node',
            message: !source
              ? `"${label}" names no node of the source — its nodes: ${fromNodes.map((n) => n.label).join(', ')}`
              : `"${label}" is sent to "${imageLabel}", which names no node of the target — ` +
                `its nodes: ${toNodes.map((n) => n.label).join(', ')}`,
          });
          continue;
        }
        imageByLabel.set(label, image);
        pairs.push(Object.freeze([source, image]) as readonly [Labeled, Labeled]);
        // the map's substance: a per-node maps-to edge, by construction —
        // exactly what makes morph(viewOfFrom, viewOfTo) legal per node
        ctx.link(source, image, 'maps-to');
        // and its choreography: demonstrate(map) sends each node to its image
        ctx.trace({ type: 'hop', subject: source, from: source, to: image });
      }
      for (const n of fromNodes) {
        if (!imageByLabel.has(n.label)) {
          diagnostics.push({
            kind: 'missing-image',
            message: `node "${n.label}" has no image — the mapping must send every source node somewhere`,
          });
        }
      }

      // Edges over edges: where both endpoints have images, the edge's image
      // must exist (matching the symbol when both structures are machines).
      const toIsGraph = isGraph(to);
      for (const e of edgesOf(from)) {
        const fu = imageByLabel.get(e.from.label);
        const fv = imageByLabel.get(e.to.label);
        if (!fu || !fv) continue; // missing-image already reported
        const symbol = (e as MachineEdge).symbol as string | undefined;
        const image = edgesOf(to).find((t) => {
          const forward = t.from.label === fu.label && t.to.label === fv.label;
          const backward = t.to.label === fu.label && t.from.label === fv.label;
          const undirected = toIsGraph && !(to as Graph).directed;
          const symbolOk = symbol === undefined || (t as MachineEdge).symbol === undefined
            ? true
            : (t as MachineEdge).symbol === symbol;
          return (forward || (undirected && backward)) && symbolOk;
        });
        if (!image) {
          diagnostics.push({
            kind: 'not-a-homomorphism',
            message:
              `edge ${e.from.label}${symbol !== undefined ? ` --${symbol}→ ` : '–'}${e.to.label} maps to ` +
              `${fu.label}–${fv.label}, but the target has no such edge — edges must map to edges`,
          });
          continue;
        }
        ctx.link(e, image, 'maps-to');
      }

      const map = ctx.value(
        'structmap',
        {
          from,
          to,
          pairs: Object.freeze(pairs),
          diagnostics: Object.freeze([...diagnostics]),
          image(label: string): Labeled {
            const found = imageByLabel.get(label);
            if (!found) {
              throw new Error(
                `structureMap has no image for "${label}" — mapped: ` +
                  ([...imageByLabel.keys()].join(', ') || '(none)'),
              );
            }
            return found;
          },
        },
      );
      return map as StructureMap;
    },
    // No automatic came-from edges: they would put a 1-hop route between the
    // map object and both whole structures, polluting morph routes exactly the
    // way stateMachine's inputs would have. The meaningful correspondence —
    // node maps-to image, edge maps-to image — is recorded explicitly above.
    { autoEdges: false },
  );

  // ─────────────────────────── the library ───────────────────────────

  function walk(subject: Graph, opts: { readonly path: readonly string[] }): GraphWalk;
  function walk(
    subject: StateMachine,
    opts: { readonly word: string; readonly from?: string },
  ): GraphWalk;
  function walk(subject: Graph | StateMachine, opts: WalkSpec): GraphWalk {
    return walkOp(subject, opts);
  }

  return Object.freeze({
    graph(opts: {
      readonly nodes: readonly string[];
      readonly edges: readonly EdgeSpec[];
      readonly directed?: boolean;
    }): Graph {
      return graphOp(opts.nodes, opts.edges, opts.directed ?? false);
    },

    walk,

    bfs(g: Graph, opts: { readonly from: string }): Traversal {
      return bfsOp(g, opts.from);
    },

    minSpanningTree(g: Graph): SpanningTree {
      return mstOp(g);
    },

    spanningTreeLive,

    totalWeight(edges: readonly GraphEdge[], label?: string): NumericHandle {
      // The edge SET is fixed at call time; the WEIGHTS are read tracked
      // inside the derived, so a Parameter-weighted edge re-sums under drag.
      const frozen = Object.freeze([...edges]);
      return derivedNumber(world, () => sumWeights(frozen), label ?? 'total weight');
    },

    structureMap(opts: {
      readonly from: Graph | StateMachine;
      readonly to: Graph | StateMachine;
      readonly nodes: Readonly<Record<string, string>>;
    }): StructureMap {
      const map = mapOp(opts.from, opts.to, opts.nodes);
      reportDiagnostics('structureMap', map.id, map.diagnostics);
      return map;
    },
  });
}
