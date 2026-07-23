/**
 * demo/main.ts — four small hand-written programs over REAL core + lesson,
 * rendered by @math-ai/render. Discipline libraries are milestone 4: all
 * semantic objects here are stand-ins built directly on core ops.
 *
 *   1. The collapse   — scatter tokens, verdict table buildUp, formula spans,
 *                       morph cloud→buckets along recorded routes, stream of
 *                       arrivals re-bucketing under cascade.
 *   2. The machine    — state graph (self-loops, edge labels, autolayout),
 *                       edges demonstrating their own derivations, a seeded
 *                       walk replayed as hops.
 *   3. Stationarity   — matrix + bars + history, slot iteration with parcel
 *                       flow (via: derivation), compareExperiment verdicts,
 *                       ambient loop + stillness, supersession by slot:set,
 *                       vary tween on a matrix cell, expose.
 *   4. The strip      — the CONTINUOUS path: plot + strip + readout reading
 *                       live quantities, a vary that shrinks Δx, a formula
 *                       transform. (Milestone 6; the others predate it.)
 *
 * Every demo is cut into BEATS (`lesson.beat`), so the page can play them
 * straight through (`__run`), step beat by beat (`__stepTo`), or seek — a
 * fresh world fast-forwarded to a beat (`__seekTo`). verify/seek.mjs compares
 * the last two.
 */

import { createWorld } from '@math-ai/core';
import type { Handle, World } from '@math-ai/core';
import { createF, createLesson } from '@math-ai/lesson';
import type { Verdict } from '@math-ai/lesson';
import {
  BarsView,
  FormulaView,
  HistoryView,
  LayoutContainerView,
  MatrixView,
  PartitionView,
  PlotView,
  Player,
  ReadoutView,
  StateGraphView,
  StripView,
  TableView,
  TokensView,
  createPlayer,
  createStage,
} from '../src/index.js';

interface Word extends Handle<'word'> {
  readonly text: string;
}

const ones = (text: string): number => text.match(/1/g)?.length ?? 0;

function speedFromQuery(): number {
  const q = new URLSearchParams(location.search).get('speed');
  const n = q ? Number(q) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function container(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  el.innerHTML = '';
  return el;
}

// ════════════════ demo 1 — the collapse ════════════════

function demo1(): Player {
  const world = createWorld();
  const lesson = createLesson(world);
  const F = createF(world);
  const stage = createStage(world, container('demo1'));

  const wordOf = world.defineOp('word.of', (ctx, text: string): Word => ctx.value('word', { text }));
  const append = world.defineOp('word.append', (ctx, base: Word, suffix: string): Word => {
    const result: Word = ctx.value('word', { text: base.text + suffix });
    ctx.trace({ type: 'append', subject: result, base: base.text, suffix });
    return result;
  });
  const membership = (w: Word): Verdict =>
    ones(w.text) % 2 === 0
      ? { label: 'ACCEPT', polarity: 'accept' }
      : { label: 'REJECT', polarity: 'reject' };

  // the histories cloud
  const words = world.collection<Word>(
    ['', '0', '1', '01', '11', '10'].map((t) => wordOf(t)),
  );
  lesson.beat('histories');
  const cloud = new TokensView(stage, words, { layout: 'scatter', title: 'histories' });
  lesson.show(cloud);
  lesson.say`Histories are infinite in variety. Sort every history by how it behaves.`;

  // probe two candidates against futures — verdicts precomputed at authoring
  const a = wordOf('0');
  const b = wordOf('00');
  const suffixes = ['', '0', '1', '01'].map((t) => wordOf(t));
  const verdicts = new Map<string, Verdict>();
  for (const row of [a, b]) {
    for (const s of suffixes) verdicts.set(`${row.id}|${s.id}`, membership(append(row, s.text)));
  }
  const table = new TableView(stage, {
    rowHeaders: [a, b],
    colHeaders: suffixes,
    cell: (r, c) => verdicts.get(`${r.id}|${c.id}`)!,
    title: 'same future, same fate?',
  });

  const nerode = F.tex`x \sim_L y \iff \forall ${F.span('suffix', 'z')} \in \Sigma^{*} : x${F.span('suffix', 'z')} \in L \Leftrightarrow y${F.span('suffix', 'z')} \in L`;
  const formulaView = new FormulaView(stage, nerode);

  lesson.beat('same future, same fate?');
  lesson.show(table);
  lesson.show(formulaView);
  lesson.link(nerode.span('suffix'), suffixes, 'represents');
  lesson.say`Compare ${a} and ${b}. Try future after future.`;
  lesson.buildUp(table, { order: 'column-by-column', pace: { start: 'slow', end: 'fast' } });
  lesson.focus(table, { emphasize: 'agreement' });
  lesson.say`Identical rows. NO future separates ${a} from ${b}.`;

  // the collapse: partition derived from words, contributes-to by construction
  const partitionOf = world.defineOp(
    'partition.of',
    (ctx, items: readonly Word[]): readonly (Handle<'class'> & { label: string })[] => {
      const even = ctx.value('class', { label: 'EVEN' });
      const odd = ctx.value('class', { label: 'ODD' });
      for (const w of items) ctx.link(w, ones(w.text) % 2 === 0 ? even : odd, 'contributes-to');
      return [even, odd];
    },
  );
  const classes = partitionOf(words.peek());
  const buckets = new PartitionView<Word>(stage, {
    classes,
    classOf: (w) => classes[ones(w.text) % 2]!,
    source: words,
    title: 'behaviors',
  });

  lesson.beat('the collapse');
  lesson.morph(cloud, buckets, { preserveIdentity: true });
  lesson.say`Two buckets — ${classes[0]!} and ${classes[1]!} — and nothing else.`;

  // the "infinitely many" idiom: keep the stream coming; buckets never multiply
  lesson.beat('however long the stream runs');
  lesson.cascade(
    ['110', '101', '111', '0000'],
    (text) => {
      const w = wordOf(text);
      lesson.show(w, { enterFrom: 'top' });
      words.add(w);
    },
    { pace: { start: 'slow', end: 'fast' } },
  );
  lesson.say`However long the stream runs, no third bucket ever appears.`;

  return createPlayer(stage, lesson, { speed: speedFromQuery() });
}

// ════════════════ demo 2 — the machine ════════════════

function demo2(): Player {
  const world = createWorld();
  const lesson = createLesson(world);
  const stage = createStage(world, container('demo2'));

  interface MState extends Handle<'state'> {
    readonly label: string;
  }
  interface MEdge extends Handle<'edge'> {
    readonly from: MState;
    readonly to: MState;
    readonly symbol: string;
  }
  interface Machine extends Handle<'machine'> {
    readonly states: readonly MState[];
    readonly edges: readonly MEdge[];
  }
  interface Walk extends Handle<'walk'> {
    readonly path: readonly MState[];
  }

  const machineOf = world.defineOp('machine.of', (ctx): Machine => {
    const even: MState = ctx.value('state', { label: 'EVEN' });
    const odd: MState = ctx.value('state', { label: 'ODD' });
    const states = [even, odd];
    const edges: MEdge[] = [];
    for (const from of states) {
      for (const symbol of ['0', '1']) {
        const to = symbol === '0' ? from : from.id === even.id ? odd : even;
        const edge: MEdge = ctx.value('edge', { from, to, symbol });
        ctx.trace({
          type: 'edge.derive',
          subject: edge,
          from,
          to,
          member: from.id === even.id ? 'ε' : '1',
          symbol,
        });
        edges.push(edge);
      }
    }
    return ctx.value('machine', { states, edges });
  });

  const machine = machineOf();

  const walkOf = world.defineOp('walk.sample', (ctx, m: Machine, steps: number, seed: number): Walk => {
    let state = m.states[0]!;
    let rng = seed;
    const path = [state];
    for (let i = 0; i < steps; i += 1) {
      rng = (rng * 1103515245 + 12345) % 2147483648;
      const symbol = rng / 2147483648 < 0.5 ? '0' : '1';
      const next = m.edges.find((e) => e.from.id === state.id && e.symbol === symbol)!.to;
      ctx.trace({ type: 'hop', index: i, from: state, to: next, symbol });
      state = next;
      path.push(state);
    }
    return ctx.value('walk', { path });
  });

  const graph = new StateGraphView(stage, {
    states: machine.states,
    edges: machine.edges,
    edgeLabel: (e) => e.symbol,
    accepting: (s) => (s as MState).label === 'EVEN',
    edgesMode: 'deferred',
    title: 'the minimal DFA',
  });

  lesson.beat('the minimal machine');
  lesson.show(graph);
  lesson.say`The machine was never designed. Watch each edge derive itself.`;
  lesson.beat('each edge derives itself');
  lesson.cascade(
    machine.edges,
    (e) => {
      lesson.demonstrate(e);
    },
    { pace: { start: 'slow', end: 'medium' } },
  );
  lesson.say`Reading ${machine.edges[0]!} keeps the class. Reading 1 swaps them.`;

  lesson.beat('one reader walks');
  const walk = walkOf(machine, 6, 7);
  lesson.say`Now let one reader walk the machine.`;
  lesson.demonstrate(walk, { pace: { start: 'medium', end: 'fast' } });
  lesson.focus(machine.states[0]!, { emphasize: 'agreement' });
  lesson.say`It ends on ${machine.states[0]!} — the word had an even number of 1s.`;

  return createPlayer(stage, lesson, { speed: speedFromQuery() });
}

// ════════════════ demo 3 — stationarity ════════════════

function demo3(): Player {
  const world = createWorld();
  const lesson = createLesson(world);
  const F = createF(world);
  const stage = createStage(world, container('demo3'));

  interface SState extends Handle<'state'> {
    readonly label: string;
  }
  interface Dist extends Handle<'distribution'> {
    readonly label: string;
    readonly mass: Readonly<Record<string, number>>;
  }

  const sunny: SState = { ...world.handle('state'), label: 'Sunny' };
  const rainy: SState = { ...world.handle('state'), label: 'Rainy' };
  const states = [sunny, rainy];

  // the mutable transition matrix + renormalize-row cells (object policy)
  const P: Record<string, Record<string, number>> = {
    Sunny: { Sunny: 0.9, Rainy: 0.1 },
    Rainy: { Sunny: 0.5, Rainy: 0.5 },
  };
  const cells = new Map<string, Handle & { value: number; setValue(n: number): void }>();
  for (const row of states) {
    for (const col of states) {
      cells.set(`${row.label}|${col.label}`, {
        ...world.handle('matrix:cell'),
        get value() {
          return P[row.label]![col.label]!;
        },
        setValue(next: number) {
          const other = states.find((s) => s.id !== col.id)!;
          P[row.label]![col.label] = next;
          P[row.label]![other.label] = 1 - next; // the row never stops being stochastic
        },
      });
    }
  }
  const cellAt = (r: Handle, c: Handle) =>
    cells.get(`${(r as SState).label}|${(c as SState).label}`)!;

  const distOf = world.defineOp(
    'dist.of',
    (ctx, label: string, mass: Readonly<Record<string, number>>): Dist =>
      ctx.value('distribution', { label, mass }),
  );
  const chainStep = world.defineOp(
    'chain.step',
    (ctx, d: Dist): Dist => {
      const mass: Record<string, number> = { Sunny: 0, Rainy: 0 };
      for (const from of states) {
        for (const to of states) {
          const parcel = d.mass[from.label]! * P[from.label]![to.label]!;
          mass[to.label]! += parcel;
          ctx.trace({ type: 'parcel', from, to, parcel });
        }
      }
      return ctx.value('distribution', { label: `${d.label}P`, mass: Object.freeze(mass) });
    },
    { autoEdges: false },
  );
  const tv = (x: Dist, y: Dist): number =>
    states.reduce((acc, s) => acc + Math.abs(x.mass[s.label]! - y.mass[s.label]!), 0) / 2;

  const p0 = distOf('p₀', { Sunny: 1, Rainy: 0 });
  const current = world.slot<Dist>(p0);

  const matrix = new MatrixView(stage, { rows: states, cols: states, cellAt, title: 'P' });
  const bars = new BarsView<Dist>(stage, current, {
    categories: states,
    mass: (d, cat) => d.mass[(cat as SState).label] ?? 0,
    title: 'probability mass',
  });
  const layout = new LayoutContainerView(stage, 'columns', [matrix, bars]);
  const history = new HistoryView<Dist>(stage, current, {
    series: states,
    valueOf: (d, s) => d.mass[(s as SState).label] ?? 0,
    title: 'convergence',
  });

  lesson.beat('pour the mass onto Sunny');
  lesson.show(layout);
  lesson.say`Pour all the probability onto ${sunny}, then let the chain run.`;

  lesson.beat('flow is matrix multiplication');
  const flowEq = F.tex`p_{t+1}(${F.span('dest', 'j')}) = ${F.span('merge', '\\sum_i')} \, ${F.span('source', 'p_t(i)')} \, ${F.span('edge', 'P_{ij}')}`;
  const formulaView = new FormulaView(stage, flowEq);
  lesson.show(formulaView);
  lesson.link(flowEq.span('source'), states, 'represents');
  lesson.link(flowEq.span('edge'), [...cells.values()], 'represents');
  lesson.show(history, { enterFrom: 'fade' });

  const iterate = (steps: number): void => {
    lesson.cascade(
      Array.from({ length: steps }, (_, i) => i),
      () => {
        current.set(chainStep(current.value), { via: 'derivation' });
      },
      { pace: { start: 'slow', end: 'fast' } },
    );
  };
  iterate(6);
  lesson.say`Each state's mass splits along its edges and re-merges. That IS matrix multiplication — and the bars move less and less.`;

  // stationarity: πP = π for this matrix at π = (5/6, 1/6)
  lesson.beat('stationarity');
  const pi = distOf('π', { Sunny: 5 / 6, Rainy: 1 / 6 });
  const eps = 1e-3;
  const exp = lesson.compareExperiment({
    subjects: [p0, pi],
    apply: (d) => chainStep(d),
    judge: (out, subj): Verdict =>
      tv(out, subj) < eps
        ? { label: 'UNCHANGED', polarity: 'accept' }
        : { label: 'MOVED', polarity: 'reject' },
    layout: 'side-by-side',
  });
  lesson.focus(exp, { emphasize: 'disagreement' });
  lesson.say`One more step moves ${p0} — but leaves ${pi} exactly where it is.`;

  lesson.beat('equilibrium is motion');
  const piEq = F.tex`${F.span('pi', '\\pi')} P = ${F.span('pi', '\\pi')}`;
  const piView = new FormulaView(stage, piEq);
  lesson.show(piView);
  lesson.link(piEq.span('pi'), pi, 'represents');

  // motion without macroscopic change
  current.set(pi, { via: 'fade' });
  lesson.parallel(() => {
    lesson.demonstrate(chainStep(pi), { loop: true, intensity: 'ambient' });
    lesson.focus(bars, { emphasize: 'stillness' });
  });
  lesson.say`Mass never stops flowing. Equilibrium is balance of motion — not absence of it.`;

  // touch it: expose the matrix, then trap the walker
  lesson.beat('trap the walker');
  lesson.expose(matrix, { as: 'draggable' });
  lesson.vary(cellAt(rainy, rainy), { to: 1, over: '2s' });
  lesson.say`Now trap the walker: from ${rainy}, all roads lead home.`;

  lesson.beat('the drain');
  current.set(p0, { via: 'fade' }); // supersedes the ambient loop (from = π)
  iterate(6);
  lesson.say`Wherever the mass starts, it drains into ${rainy} and stays.`;

  return createPlayer(stage, lesson, { speed: speedFromQuery() });
}

// ════════════════ demo 4 — the shrinking strip ════════════════
//
// The CONTINUOUS path (milestone 6), and the one that makes segmented
// playback interesting: a plot/strip/readout read their quantities LIVE, so
// what they show is whatever the varied parameter currently holds. Playing
// beat 2 rewinds Δx and tweens it down; FAST-FORWARDING beat 2 must land Δx
// on exactly the same value with no tween — and the formula transform in beat
// 3 must have happened, spans and all.

function demo4(): Player {
  const world = createWorld();
  const lesson = createLesson(world);
  const F = createF(world);
  const stage = createStage(world, container('demo4'));

  const f = (x: number): number => 0.4 * x * x + 0.5;
  const antiderivative = (x: number): number => (0.4 * x * x * x) / 3 + 0.5 * x;
  const X0 = 1.4;

  /** A live scalar: reads through a slot, `poke`d on the interaction path. */
  const scalar = (kind: string, initial: number) => {
    const slot = world.slot(initial);
    const base = world.handle(kind);
    return {
      id: base.id,
      kind,
      get value(): number {
        return slot.value;
      },
      setValue(next: number): void {
        slot.set(next);
      },
      setValueLive(next: number): void {
        slot.poke(next);
      },
    };
  };
  /** A derived live scalar — no setter, it just reads. */
  const derived = (kind: string, read: () => number) => {
    const base = world.handle(kind);
    return {
      id: base.id,
      kind,
      get value(): number {
        return read();
      },
    };
  };

  const fn = world.handle('function');
  const strip = world.handle('strip');
  const at = derived('scalar', () => X0);
  const dx = scalar('scalar', 0.8);
  const height = derived('scalar', () => f(X0));
  const area = derived('scalar', () => antiderivative(X0 + dx.value) - antiderivative(X0));
  const ratio = derived('scalar', () => area.value / dx.value);

  const plot = new PlotView(stage, { subject: fn, sample: f, domain: [0, 3], label: 'f' });
  const stripView = new StripView(stage, {
    subject: strip,
    at,
    width: dx,
    height,
    area,
    sample: f,
    on: fn,
  });
  const readout = new ReadoutView(stage, {
    quantity: ratio,
    label: '\\Delta A / \\Delta x',
    compareTo: height,
    compareLabel: 'f(x)',
  });

  lesson.beat('the curve');
  lesson.show(plot);
  lesson.say`Here is ${fn}. Ask how much area it sweeps out.`;

  lesson.beat('a strip of area');
  lesson.show(stripView);
  lesson.show(readout, { enterFrom: 'fade' });
  const product = F.tex`\Delta A = ${F.span('f', 'f(x)')} \, ${F.span('dx', '\\Delta x')}`;
  const formula = new FormulaView(stage, product);
  lesson.show(formula);
  lesson.link(product.span('dx'), dx, 'represents');
  lesson.say`A thin strip has area about ${height} times ${dx}.`;

  lesson.beat('let the strip shrink');
  lesson.vary(dx, { to: 0.05, over: '2s' });
  lesson.say`The thinner it gets, the better that approximation is.`;

  lesson.beat('divide across');
  const quotient = F.tex`\frac{\Delta A}{${F.span('dx', '\\Delta x')}} = ${F.span('f', 'f(x)')}`;
  lesson.transformFormula(product, quotient);
  lesson.say`Divide across: the area's rate of change IS the height of the curve.`;

  return createPlayer(stage, lesson, { speed: speedFromQuery() });
}

// ════════════════ page wiring ════════════════

declare global {
  interface Window {
    __run(n: number): Promise<void>;
    /** Beat titles of a demo (authors a throwaway world). */
    __titles(n: number): (string | undefined)[];
    /** Play beats 0..k one at a time, pausing at every boundary (the student's path). */
    __stepTo(n: number, k: number): Promise<void>;
    /** Fresh world: fast-forward beats 0..k-1 silently, then play beat k. */
    __seekTo(n: number, k: number): Promise<void>;
    __status: string;
    __player: Player | null;
  }
}

const demos = [demo1, demo2, demo3, demo4];

window.__status = 'ready';
window.__player = null;

function fresh(n: number): Player {
  window.__player?.stopAmbient();
  const player = demos[n - 1]!();
  window.__player = player;
  return player;
}

window.__run = async (n: number): Promise<void> => {
  try {
    window.__status = `running:${n}`;
    await fresh(n).play();
    window.__status = `done:${n}`;
  } catch (error) {
    window.__status = `error:${n}:${(error as Error).message}`;
    throw error;
  }
};

window.__titles = (n: number): (string | undefined)[] => [...fresh(n).titles];

window.__stepTo = async (n: number, k: number): Promise<void> => {
  try {
    window.__status = `stepping:${n}`;
    const player = fresh(n);
    for (let i = 0; i <= k; i += 1) await player.next();
    window.__status = `at:${n}:${player.segmentIndex}`;
  } catch (error) {
    window.__status = `error:${n}:${(error as Error).message}`;
    throw error;
  }
};

window.__seekTo = async (n: number, k: number): Promise<void> => {
  try {
    window.__status = `seeking:${n}`;
    const player = fresh(n);
    await player.seek(k);
    window.__status = `at:${n}:${player.segmentIndex}`;
  } catch (error) {
    window.__status = `error:${n}:${(error as Error).message}`;
    throw error;
  }
};

for (let i = 1; i <= demos.length; i += 1) {
  document.getElementById(`run${i}`)?.addEventListener('click', () => void window.__run(i));
}
if (new URLSearchParams(location.search).has('auto')) {
  void (async () => {
    for (let i = 1; i <= demos.length; i += 1) await window.__run(i);
    window.__status = 'done:all';
  })();
}
