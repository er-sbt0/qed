/**
 * views.ts — the `View` / `Layout` constructors of the spike programs, bound
 * to one render `Stage`. Thin factories over the milestone-3 view classes;
 * the reconciliation work lives here:
 *
 *  - `View.stateGraph` accepts BOTH spike shapes: a `StateMachine`
 *    (myhill-nerode api — `{layout?}`) and a `MarkovChain` (markov api —
 *    `{edgeLabels?, mass?}`), dispatching on the object. Machine graphs
 *    default to `edgesMode: "deferred"` (the discipline idiom: edges ink in
 *    as their derivations are demonstrated); chain graphs show their edges.
 *  - `View.bars` accepts a core `Slot<Distribution>` (timeline-faithful:
 *    masses snapshot per step at authoring time) or a plain `Distribution`
 *    (LIVE: re-read on every refresh — this is how a stationary π moves under
 *    a matrix drag).
 *  - Distributions carry their `states`, so bars/history need no categories
 *    option — the spike signatures stay exactly as authored.
 */

import { Slot } from '@math-ai/core';
import type { Handle } from '@math-ai/core';
import type { Collection } from '@math-ai/core';
import type { Formula, NumericHandle, Verdict } from '@math-ai/lesson';
import {
  BarsView,
  ClaimView,
  DiagramView,
  FieldView,
  HeatmapView,
  LoopView,
  TilingView,
  FormulaView,
  HistoryView,
  LayoutContainerView,
  MatrixView,
  PartitionView,
  PlaneView,
  PlotView,
  ReadoutView,
  RegionView,
  RiemannView,
  StateGraphView,
  StripView,
  TableView,
  TokensView,
  VectorsView,
  View as RenderView,
  fmt,
  plainTex,
} from '@math-ai/render';
import type { ClaimSubject, DiagramPen, Stage, TilingEdgeRef } from '@math-ai/render';
import type { Partition, StateMachine, Word } from './automata.js';
import type { Graph, GraphEdge, LiveSpanningTree } from './graph.js';
import type { Distribution, MarkovChain, StochasticMatrix } from './probability.js';
import { integrate } from './calculus.js';
import type { Accumulation, Fn, Increment, RiemannSum } from './calculus.js';
import type { LinearMap, Matrix2, Polygon, Vector2 } from './linalg.js';
import type { OrientedLoop, PlaneRegion, ScalarField, Segment, Tiling, VectorField } from './field.js';
import type { Parameter } from './parameter.js';

export type CellContent = string | Verdict | Handle;

export interface ViewLib {
  tokens(
    source: Collection<Word> | readonly Word[],
    opts?: { readonly layout?: 'row' | 'column' | 'scatter' },
  ): TokensView<Word>;
  partition(p: Partition<Word>, opts?: { readonly as?: 'buckets' }): PartitionView<Word>;
  stateGraph(
    subject: StateMachine | MarkovChain,
    opts?: {
      readonly layout?: 'auto';
      readonly edgeLabels?: 'probability' | 'none';
      readonly mass?: Slot<Distribution>;
    },
  ): StateGraphView;
  /**
   * A `Graph.graph` on the same node-edge stage: undirected graphs draw joins
   * (no arrowheads), weights become edge labels. `edgesMode: "deferred"`
   * pre-hides edges so `demonstrate(g)` / `demonstrate(tree)` inks them in.
   * Weight labels are re-read on every applyState, so a Parameter-weighted
   * edge repaints under a drag; `tree` (a `Graph.spanningTreeLive` result)
   * additionally emphasizes the CURRENT tree's edges live — membership is
   * re-read too, which is what makes the tree visibly flip.
   */
  graph(
    g: Graph,
    opts?: {
      readonly edgesMode?: 'shown' | 'deferred';
      readonly weights?: 'shown' | 'none';
      readonly tree?: LiveSpanningTree;
    },
  ): StateGraphView;
  table<Rh extends Handle, Ch extends Handle>(opts: {
    readonly rowHeaders: readonly Rh[];
    readonly colHeaders: readonly Ch[];
    readonly cell: (row: Rh, col: Ch) => CellContent;
  }): TableView<Rh, Ch>;
  /** A transition matrix (labelled by states) or a plain 2×2 linear map. */
  matrix(m: StochasticMatrix | Matrix2): MatrixView;
  bars(
    source: Slot<Distribution> | Distribution,
    opts?: { readonly label?: string },
  ): BarsView<Distribution>;
  history(
    source: Slot<Distribution>,
    opts: { readonly x: 'step'; readonly y: 'probability' },
  ): HistoryView<Distribution>;
  formula(f: Formula): FormulaView;

  // ── continuous views (calculus + linear algebra) ──

  /** A continuous plot y = f(x), or A(x) as a function of its upper limit. */
  plot(
    subject: Fn | Accumulation,
    opts: {
      readonly domain: readonly [number, number];
      readonly showAxes?: boolean;
      readonly label?: string;
    },
  ): PlotView;
  /**
   * A filled region: the signed area under a curve up to a live upper limit
   * (calculus), or a polygon whose vertices are live (linear algebra).
   */
  region(
    spec: { readonly under: Fn; readonly from: number; readonly to: Parameter; readonly signed?: boolean },
    opts?: { readonly label?: string },
  ): RegionView;
  region(polygon: Polygon, opts?: { readonly label?: string }): RegionView;
  /** The increment strip drawn as a rectangle on the curve. */
  strip(increment: Increment): StripView;
  /** The Riemann rectangles; each registers under its own Rectangle handle. */
  riemann(sum: RiemannSum, opts?: { readonly label?: string }): RiemannView;
  /** A live numeric readout, optionally watched against a second quantity. */
  readout(
    quantity: NumericHandle,
    opts?: { readonly label?: string; readonly compareTo?: NumericHandle },
  ): ReadoutView;
  /**
   * A live proposition: both sides, the relation, and a status badge that
   * flips the moment the claim stops holding. Pair it with an exposed
   * Parameter — the student tries to break the claim and watches whether it
   * survives, which is the difference between an illustration and a theorem.
   */
  claim(claim: ClaimSubject, opts?: { readonly label?: string; readonly showValues?: boolean }): ClaimView;
  /** The coordinate plane, optionally the lattice UNDER a linear map. */
  coordinatePlane(opts?: {
    readonly grid?: boolean;
    readonly map?: LinearMap;
    readonly domain?: readonly [number, number];
  }): PlaneView;
  /**
   * A vector field sampled on a lattice — arrows over a patch of the plane.
   * `View.vectors` is origin-anchored and cannot do this. The rule is re-run
   * per sample on every repaint, so a Parameter read INSIDE the field's
   * closure redraws every arrow under a drag with no extra wiring.
   */
  field(
    F: VectorField,
    opts?: {
      /** Borrow the frame from a region instead of restating it — see `over`
       *  on View.heatmap for why this is the preferred form. */
      readonly over?: PlaneRegion;
      readonly domain?: readonly [number, number];
      readonly range?: readonly [number, number];
      readonly grid?: number;
      readonly label?: string;
    },
  ): FieldView;
  /**
   * The geometry ESCAPE HATCH: an open canvas the program draws low-level marks
   * on — point · path · text · glyph — in MATH-SPACE coordinates of a declared
   * frame. `draw` reads LiveValues (a Parameter) and is re-run on every repaint,
   * so a mark that depends on a dragged parameter moves with it. No pixels ever
   * appear in `draw`; the frame owns the pixel mapping, ticks and fit. This is
   * the bottom tier the hand-written `View.*` renderers sit above — reach for it
   * when no view fits the idea.
   */
  diagram(
    frameSpec: {
      readonly domain: readonly [number, number];
      readonly range: readonly [number, number];
      readonly width?: number;
      readonly height?: number;
      readonly pad?: number;
      /** Default column count for `pen.col(k)`. */
      readonly cols?: number;
    },
    draw: (pen: DiagramPen) => void,
    opts?: { readonly label?: string },
  ): DiagramView;
  /**
   * A scalar field as a colored cell grid — where a quantity is positive,
   * negative, and strong. `View.heatmap(Field.curl(F))` is the picture of
   * microscopic circulation.
   */
  heatmap(
    g: ScalarField,
    opts?: {
      /**
       * Draw over a region's OWN extent: `View.heatmap(Field.curl(F), { over: omega })`.
       *
       * Prefer this to restating `domain`/`range`. The region already knows
       * where it is, and a hand-written domain that disagrees with it is a
       * silent lie about what the picture shows — the one piece of `Space` the
       * Green probe's ledger actually asked for (roadmap step 3).
       * Explicit `domain`/`range` still win if both are given.
       */
      readonly over?: PlaneRegion;
      readonly domain?: readonly [number, number];
      readonly range?: readonly [number, number];
      readonly grid?: number;
      readonly label?: string;
    },
  ): HeatmapView;
  /**
   * An oriented loop drawn edge by edge, each segment registered under its own
   * handle — which is what lets `lesson.focus(segment)` light ONE edge and
   * `lesson.demonstrate(Field.walk(F, loop))` ink the contributions in turn.
   * Overlay it on a `View.field` and it borrows that field's frame.
   */
  loop(
    loop: OrientedLoop,
    opts?: {
      readonly label?: string;
      readonly over?: PlaneRegion;
      readonly domain?: readonly [number, number];
      readonly range?: readonly [number, number];
      readonly showOrientation?: boolean;
    },
  ): LoopView;
  /**
   * A tiling, with interior and boundary edges visually distinct. Two adjacent
   * cells share ONE segment handle, so focusing it lights both sides of the
   * cancellation — the beat this whole vocabulary exists for.
   */
  tiling(
    tiling: Tiling,
    opts?: {
      readonly label?: string;
      readonly over?: PlaneRegion;
      readonly domain?: readonly [number, number];
      readonly range?: readonly [number, number];
      readonly cellsMode?: 'shown' | 'deferred';
    },
  ): TilingView;
  /** Vectors as arrows from the origin. */
  vectors(vs: readonly Vector2[], opts?: { readonly labels?: readonly string[] }): VectorsView;
}

export interface LayoutLib {
  columns(children: readonly Handle[]): LayoutContainerView;
  stack(children: readonly Handle[]): LayoutContainerView;
  overlay(children: readonly Handle[]): LayoutContainerView;
}

/** Narration-friendly label for a view (`${matrix}` in a say template). */
function tagLabel(view: RenderView, label: string | undefined): void {
  if (label === undefined) return;
  (view as RenderView & { label?: string }).label = label;
}

/**
 * Bars/graph labels land in SVG text nodes, which KaTeX cannot render into, so
 * they get the unicode approximation. Labels that reach the HTML flow
 * (readouts, plot captions, narration mentions) keep their TeX and are
 * typeset by the view.
 */
const prettifyTex = plainTex;

function isStochastic(m: StochasticMatrix | Matrix2): m is StochasticMatrix {
  return 'states' in m;
}

function isChain(subject: StateMachine | MarkovChain): subject is MarkovChain {
  return 'transitions' in subject;
}

interface UnderSpec {
  readonly under: Fn;
  readonly from: number;
  readonly to: Parameter;
  readonly signed?: boolean;
}

function isPolygon(x: UnderSpec | Polygon): x is Polygon {
  return (x as Polygon).kind === 'polygon';
}

function vertexOf(v: Vector2): { handle: Vector2; x(): number; y(): number } {
  return { handle: v, x: () => v.x, y: () => v.y };
}

/** Fields are sampled by their `rule`, so a plain closure silently half-works. */
function assertField(f: unknown, where: string, build: string): void {
  if (f == null || typeof (f as { rule?: unknown }).rule !== 'function') {
    throw new Error(`${where} needs a field handle — build one with ${build}. Got ${String(f)}.`);
  }
}

/** A loop is walked through its segments, so a bare polygon silently draws nothing. */
function assertLoop(l: unknown, where: string): void {
  if (l == null || !Array.isArray((l as { segments?: unknown }).segments)) {
    throw new Error(
      `${where} needs an oriented loop — build one with Field.rectangleLoop / ` +
        `Field.circleLoop / Field.loop, or take region.boundary. Got ${String(l)}.`,
    );
  }
}

/** The patch of plane a field is drawn over when the program does not say. */
const DEFAULT_FIELD_DOMAIN: readonly [number, number] = [-3, 3];

/**
 * Resolve a view's frame: an explicit domain/range wins, then a region's own
 * extent (`over`), then the default patch.
 *
 * The region's extent is SNAPSHOT here, not tracked. A view's frame is fixed
 * at construction in every backend, and a viewport that follows a dragged
 * corner is a separate concern with no evidence behind it yet. What `over`
 * buys today is that the frame cannot be authored to disagree with the region
 * it is supposedly showing.
 */
function frameOf(opts?: {
  readonly over?: PlaneRegion;
  readonly domain?: readonly [number, number];
  readonly range?: readonly [number, number];
}): { domain: readonly [number, number]; range: readonly [number, number] | undefined } {
  if (opts?.domain) return { domain: opts.domain, range: opts.range };
  if (opts?.over) {
    const [[x0, y0], [x1, y1]] = opts.over.domain.value;
    return { domain: [x0, x1], range: opts.range ?? [y0, y1] };
  }
  return { domain: DEFAULT_FIELD_DOMAIN, range: opts?.range };
}

function labelOfNumeric(q: NumericHandle): string | undefined {
  return (q as NumericHandle & { label?: string }).label;
}

/**
 * A readout tracks a LIVE quantity. Handed a plain number it used to build
 * fine and die later reading `.value` off it — `undefined.toFixed(...)`, with
 * nothing naming the cause. The trap is real: `Fn.at(x)` and
 * `Accumulation.at(u)` both return numbers, so `View.readout(f.at(0))` reads
 * as if it were live when it is a snapshot taken once at authoring time.
 */
function assertLiveNumeric(q: NumericHandle, where: string): void {
  if (typeof q === 'number') {
    throw new Error(
      `${where} needs a LIVE numeric handle, not a plain number — you passed ${q}. ` +
        `Fn.at(x) and Accumulation.at(u) return snapshots, not handles. Pass a Parameter, ` +
        `or a live quantity like strip.averageRate / strip.approxHeight / A.slopeAt(x).`,
    );
  }
  if (q == null || typeof (q as { value?: unknown }).value !== 'number') {
    throw new Error(`${where} needs a live numeric handle with a numeric .value — got ${String(q)}.`);
  }
}

/**
 * The height rule a plot samples ONCE at authoring time (capture policy).
 *
 * For an accumulation, sampling `A.at(u)` per point would re-run a full
 * quadrature per sample — and `rate.rule` is a guest closure in the sandbox,
 * so that is tens of thousands of boundary crossings for one curve. Instead
 * the antiderivative is built cumulatively across the domain in one pass, then
 * read by interpolation: the same curve, O(samples) closure calls.
 */
function samplerFor(subject: Fn | Accumulation, domain: readonly [number, number]): (x: number) => number {
  if (subject.kind === 'fn') return (x: number) => subject.rule(x);
  const acc = subject;
  const [d0, d1] = domain;
  const steps = 240;
  const h = (d1 - d0) / steps;
  const values: number[] = [integrate(acc.rate.rule, acc.from, d0)];
  for (let i = 0; i < steps; i += 1) {
    const x0 = d0 + i * h;
    // trapezoid over one sub-interval: one rule call per step, reused
    values.push(values[i]! + ((acc.rate.rule(x0) + acc.rate.rule(x0 + h)) / 2) * h);
  }
  return (x: number): number => {
    const t = (x - d0) / h;
    const i = Math.min(steps - 1, Math.max(0, Math.floor(t)));
    const frac = Math.min(1, Math.max(0, t - i));
    return values[i]! + (values[i + 1]! - values[i]!) * frac;
  };
}

export function createViews(stage: Stage): { View: ViewLib; Layout: LayoutLib } {
  const childViews = (children: readonly Handle[]): readonly RenderView[] =>
    children.map((child) => {
      const view = stage.viewById(child.id);
      if (!view) {
        throw new Error(
          `Layout child ${child.id} (${child.kind}) is not a view on this stage — ` +
            `layout children must be View.* results`,
        );
      }
      return view;
    });

  const View: ViewLib = {
    tokens(source, opts) {
      return new TokensView<Word>(stage, source, { layout: opts?.layout });
    },

    partition(p, _opts) {
      return new PartitionView<Word>(stage, {
        get classes() {
          return p.classes;
        },
        classOf: (item) => p.classOf(item),
        source: p.source,
      });
    },

    stateGraph(subject, opts) {
      if (isChain(subject)) {
        return new StateGraphView(stage, {
          states: subject.states.items,
          edges: subject.transitions,
          edgeLabel: (t) =>
            (opts?.edgeLabels ?? 'probability') === 'none' ? '' : fmt(t.probability),
          edgesMode: 'shown',
        });
      }
      return new StateGraphView(stage, {
        states: subject.states,
        edges: subject.edges,
        edgeLabel: (e) => e.symbol,
        accepting: (state) => subject.states.some((s) => s.id === state.id && s.accepting),
        // the discipline idiom: machine edges ink in as they demonstrate
        edgesMode: 'deferred',
      });
    },

    graph(g, opts) {
      const weights = opts?.weights ?? 'shown';
      const tree = opts?.tree;
      return new StateGraphView<GraphEdge>(stage, {
        states: g.nodes,
        edges: g.edges,
        // re-read per applyState: a live (Parameter-backed) weight repaints
        edgeLabel: (e) =>
          weights === 'none' || e.weight === undefined ? '' : fmt(e.weight),
        // live membership: the tree flips under a weight drag, zero authoring
        ...(tree ? { edgeEmphasis: (e: GraphEdge) => tree.inTree(e) } : {}),
        directed: g.directed,
        edgesMode: opts?.edgesMode ?? 'shown',
      });
    },

    table(opts) {
      return new TableView(stage, {
        rowHeaders: opts.rowHeaders,
        colHeaders: opts.colHeaders,
        cell: (row, col) => opts.cell(row, col),
      });
    },

    matrix(m: StochasticMatrix | Matrix2): MatrixView {
      if (!isStochastic(m)) {
        // a plain 2×2: the cells ARE the draggable parameters, and there are
        // no state labels to head the axes
        const rows = [stage.world.handle('matrix:row'), stage.world.handle('matrix:row')];
        const cols = [stage.world.handle('matrix:col'), stage.world.handle('matrix:col')];
        const indexOf = (axis: readonly Handle[], h: Handle): 0 | 1 =>
          axis[1] !== undefined && h.id === axis[1].id ? 1 : 0;
        const view = new MatrixView(stage, {
          rows,
          cols,
          cellAt: (row, col) => m.cell(indexOf(rows, row), indexOf(cols, col)),
          headers: false,
          onEdit: () => stage.applyStateAll(),
        });
        tagLabel(view, 'matrix');
        return view;
      }
      const view = new MatrixView(stage, {
        rows: m.states.items,
        cols: m.states.items,
        cellAt: (row, col) => m.cell(labelOfHandle(row), labelOfHandle(col)),
        // live derived numerics repaint on every interactive edit (π follows)
        onEdit: () => stage.applyStateAll(),
      });
      tagLabel(view, 'matrix');
      return view;
    },

    bars(source, opts) {
      if (source instanceof Slot) {
        const first = source.peek();
        const view = new BarsView<Distribution>(stage, source, {
          categories: first.states.items,
          mass: (d, cat) => d.mass(cat as Distribution['states']['items'][number]),
        });
        tagLabel(view, opts?.label ? prettifyTex(opts.label) : undefined);
        return view;
      }
      // a live value (e.g. a reactive stationary π): re-read on refresh
      const view = new BarsView<Distribution>(stage, () => source, {
        categories: source.states.items,
        mass: (d, cat) => d.mass(cat as Distribution['states']['items'][number]),
      });
      tagLabel(view, opts?.label ? prettifyTex(opts.label) : source.label);
      return view;
    },

    history(source, _opts) {
      const first = source.peek();
      return new HistoryView<Distribution>(stage, source, {
        series: first.states.items,
        valueOf: (d, s) => d.mass(s as Distribution['states']['items'][number]),
      });
    },

    formula(f) {
      return new FormulaView(stage, f);
    },

    // ── continuous views ──

    plot(subject, opts) {
      return new PlotView(stage, {
        subject,
        sample: samplerFor(subject, opts.domain),
        domain: opts.domain,
        showAxes: opts.showAxes,
        label: opts.label ?? subject.label,
      });
    },

    region(spec: UnderSpec | Polygon, opts?: { readonly label?: string }): RegionView {
      if (isPolygon(spec)) {
        const polygonView = new RegionView(stage, {
          mode: 'polygon',
          subject: spec,
          vertices: spec.vertices.map((v) => vertexOf(v)),
          area: spec.area,
          label: opts?.label,
        });
        // `${squareRegion}` in a say should read "unit square", not a view id
        tagLabel(polygonView, opts?.label);
        return polygonView;
      }
      const view = new RegionView(stage, {
        mode: 'under',
        subject: spec.under,
        sample: (x) => spec.under.rule(x),
        from: spec.from,
        to: spec.to,
        signed: spec.signed,
        label: opts?.label,
      });
      tagLabel(view, opts?.label ?? spec.under.label);
      return view;
    },

    strip(increment) {
      return new StripView(stage, {
        subject: increment,
        at: increment.at,
        width: increment.width,
        height: increment.approxHeight,
        area: increment.area,
        sample: (x) => increment.of.rate.rule(x),
        on: increment.of.rate,
      });
    },

    riemann(sum, opts) {
      return new RiemannView(stage, {
        subject: sum,
        rectangles: sum.rectangles.map((r) => ({
          handle: r,
          x0: r.x0,
          x1: r.x1,
          height: r.height,
        })),
        label: opts?.label,
        sample: (x) => sum.of.rule(x),
        on: sum.of,
      });
    },

    readout(quantity, opts) {
      assertLiveNumeric(quantity, 'View.readout(quantity)');
      if (opts?.compareTo !== undefined) {
        assertLiveNumeric(opts.compareTo, 'View.readout(_, { compareTo })');
      }
      const view = new ReadoutView(stage, {
        quantity,
        label: opts?.label ?? labelOfNumeric(quantity),
        compareTo: opts?.compareTo,
        compareLabel: opts?.compareTo ? labelOfNumeric(opts.compareTo) : undefined,
      });
      tagLabel(view, opts?.label);
      return view;
    },

    claim(claim, opts) {
      if (claim == null || typeof (claim as { holds?: unknown }).holds !== 'boolean') {
        throw new Error(
          `View.claim(claim) needs a claim handle — build one with M.claim({ lhs, rhs, relation }). ` +
            `Got ${String(claim)}.`,
        );
      }
      const view = new ClaimView(stage, {
        claim,
        label: opts?.label ?? claim.label,
        showValues: opts?.showValues,
      });
      tagLabel(view, opts?.label ?? claim.label);
      return view;
    },

    field(F, opts) {
      assertField(F, 'View.field(F)', 'Field.vectorField((x, y) => [P, Q])');
      const frame = frameOf(opts);
      const view = new FieldView(stage, {
        rule: F.rule,
        domain: frame.domain,
        range: frame.range,
        grid: opts?.grid,
        label: opts?.label ?? F.label,
        subject: F,
      });
      tagLabel(view, opts?.label);
      return view;
    },

    diagram(frameSpec, draw, opts) {
      const view = new DiagramView(stage, { frame: frameSpec, draw, label: opts?.label });
      tagLabel(view, opts?.label);
      return view;
    },

    heatmap(g, opts) {
      assertField(g, 'View.heatmap(g)', 'Field.scalarField(...) or Field.curl(F)');
      const frame = frameOf(opts);
      const view = new HeatmapView(stage, {
        rule: g.rule,
        domain: frame.domain,
        range: frame.range,
        grid: opts?.grid,
        label: opts?.label ?? g.label,
        subject: g,
      });
      tagLabel(view, opts?.label);
      return view;
    },

    loop(loop, opts) {
      assertLoop(loop, 'View.loop(loop)');
      const view = new LoopView(stage, {
        subject: loop,
        segments: loop.segments.map((s) => ({ handle: s, from: s.from, to: s.to })),
        label: opts?.label ?? loop.label,
        // no `over` and no domain means "borrow the frame of whatever this is
        // overlaid on", which is the common case — so do NOT default here.
        ...(opts?.over ? frameOf(opts) : { domain: opts?.domain, range: opts?.range }),
        showOrientation: opts?.showOrientation,
      });
      tagLabel(view, opts?.label);
      return view;
    },

    tiling(tiling, opts) {
      if (tiling == null || !Array.isArray((tiling as { tiles?: unknown }).tiles)) {
        throw new Error(
          `View.tiling(t) needs a tiling — build one with Field.tile(region, { n }). Got ${String(tiling)}.`,
        );
      }
      const edge = (e: Segment, interior: boolean): TilingEdgeRef => ({
        handle: e,
        from: e.from,
        to: e.to,
        interior,
      });
      const view = new TilingView(stage, {
        subject: tiling,
        cells: tiling.tiles.map((t) => ({ handle: t, corners: t.boundary.points })),
        edges: [
          ...tiling.interiorEdges.map((e) => edge(e, true)),
          ...tiling.boundaryEdges.map((e) => edge(e, false)),
        ],
        label: opts?.label,
        ...(opts?.over ? frameOf(opts) : { domain: opts?.domain, range: opts?.range }),
        cellsMode: opts?.cellsMode,
      });
      tagLabel(view, opts?.label);
      return view;
    },

    coordinatePlane(opts) {
      const map = opts?.map;
      return new PlaneView(stage, {
        grid: opts?.grid,
        domain: opts?.domain,
        // read the matrix entries directly: applying through `applyVector`
        // would mint a handle per lattice point on every repaint
        map: map
          ? (x, y) => ({
              x: map.matrix.cell(0, 0).value * x + map.matrix.cell(0, 1).value * y,
              y: map.matrix.cell(1, 0).value * x + map.matrix.cell(1, 1).value * y,
            })
          : undefined,
      });
    },

    vectors(vs, opts) {
      return new VectorsView(stage, {
        vectors: vs.map((v, i) => ({
          handle: v,
          x: () => v.x,
          y: () => v.y,
          label: opts?.labels?.[i] ? prettifyTex(opts.labels[i]!) : undefined,
        })),
      });
    },
  };

  const Layout: LayoutLib = {
    columns: (children) => new LayoutContainerView(stage, 'columns', childViews(children)),
    stack: (children) => new LayoutContainerView(stage, 'stack', childViews(children)),
    overlay: (children) => new LayoutContainerView(stage, 'overlay', childViews(children)),
  };

  return { View, Layout };
}

function labelOfHandle(h: Handle): string {
  return (h as Handle & { label?: string }).label ?? h.id;
}
