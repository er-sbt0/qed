/**
 * acceptance.myhill-nerode.test.ts — the structural skeleton of
 * spikes/myhill-nerode/beats.ts, authored against the real verbs with minimal
 * stand-in objects built directly on core ops (discipline libraries are
 * milestone 4; views are milestone 3 — stand-ins expose `elements` /
 * `buildUpGroups` where the spike used View.*).
 *
 * Beat 2 — the distinguishing experiment (compareExperiment + behavior table)
 * Beat 3 — the collapse (partition-morph + the reactive stream of arrivals)
 * Beat 4 — the reinterpretation (classes become states, edges demonstrate
 *          their own derivations)
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, CascadeStep, Handle, World } from '@math-ai/core';
import { createLesson, Lesson } from './lesson.js';
import type {
  DemonstrateEventPayload,
  MorphPayload,
  MorphSubject,
  SayPayload,
  Verdict,
} from './types.js';

// ── minimal automata stand-ins over core ops ──

interface Word extends Handle<'word'> {
  readonly text: string;
}
interface EquivClass extends Handle<'class'> {
  readonly label: string;
}
interface MachineState extends Handle<'state'> {
  readonly label: string;
}
interface MachineEdge extends Handle<'edge'> {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly symbol: string;
}
interface Machine extends Handle<'machine'> {
  readonly states: readonly MachineState[];
  readonly edges: readonly MachineEdge[];
}

const ones = (text: string): number => text.match(/1/g)?.length ?? 0;
/** L = "even number of 1s" */
const membership = (w: Word): Verdict =>
  ones(w.text) % 2 === 0
    ? { label: 'ACCEPT', polarity: 'accept' }
    : { label: 'REJECT', polarity: 'reject' };

function setup() {
  const world = createWorld();
  const lesson = createLesson(world);

  const wordOf = world.defineOp('word.of', (ctx, text: string): Word => ctx.value('word', { text }));
  const append = world.defineOp('word.append', (ctx, base: Word, suffix: string): Word => {
    const result = ctx.value('word', { text: base.text + suffix });
    ctx.trace({ type: 'append', subject: result, base: base.text, suffix });
    return result;
  });

  /** The collapse: classes derived from words, contributes-to recorded by construction. */
  const partitionOf = world.defineOp(
    'partition.of',
    (ctx, items: readonly Word[]): readonly EquivClass[] => {
      const even = ctx.value('class', { label: 'EVEN' });
      const odd = ctx.value('class', { label: 'ODD' });
      for (const w of items) ctx.link(w, ones(w.text) % 2 === 0 ? even : odd, 'contributes-to');
      return [even, odd];
    },
  );

  /**
   * The reinterpretation: states from partition classes (counterpart-of
   * recorded by construction), edges from running the transition — each edge's
   * derivation is a subject-tagged trace event, replayable per edge.
   */
  const machineOf = world.defineOp(
    'machine.of',
    (ctx, classes: readonly EquivClass[]): Machine => {
      const states = classes.map((cls) => {
        const state = ctx.value('state', { label: cls.label });
        ctx.link(cls, state, 'counterpart-of');
        return state;
      });
      const edges: MachineEdge[] = [];
      for (const from of states) {
        for (const symbol of ['0', '1']) {
          const toLabel =
            symbol === '0' ? from.label : from.label === 'EVEN' ? 'ODD' : 'EVEN';
          const edge = ctx.value('edge', { fromLabel: from.label, toLabel, symbol });
          ctx.trace({
            type: 'edge.derive',
            subject: edge,
            member: from.label === 'EVEN' ? '' : '1', // the witness member
            symbol,
            landed: toLabel,
          });
          edges.push(edge);
        }
      }
      return ctx.value('machine', { states, edges });
    },
  );

  const view = (kind: string, elements: readonly Handle[]): MorphSubject =>
    Object.freeze({ ...world.handle(kind), elements });

  return { world, lesson, wordOf, append, partitionOf, machineOf, view };
}

/** The spike's userland macro: probe futures as a build-up table. */
function probeContinuations(
  world: World,
  lesson: Lesson,
  wordOf: (text: string) => Word,
  suffixTexts: readonly string[],
) {
  const suffixes = suffixTexts.map((t) => wordOf(t));
  const cols = suffixes.map((s) => Object.freeze({ ...world.handle('table:col'), header: s }));
  const table = Object.freeze({
    ...world.handle('view:table'),
    buildUpGroups: (order: string) =>
      order === 'column-by-column' ? cols.map((c) => [c] as const) : [],
  });
  lesson.show(table);
  lesson.buildUp(table, { order: 'column-by-column', pace: { start: 'slow', end: 'fast' } });
  return { table, suffixes }; // macros return the handles they mint
}

describe('Myhill–Nerode skeleton (beats 2–4)', () => {
  it('beat 2 — the distinguishing experiment', () => {
    const { world, lesson, wordOf, append, view } = setup();
    const x = wordOf('0');
    const y = wordOf('100');

    lesson.show(view('view:tokens', [x, y]));
    lesson.say`Are ${x} and ${y} genuinely different pasts?`;
    const experiment = lesson.compareExperiment({
      subjects: [x, y],
      apply: (h) => append(h, '1'),
      judge: membership,
      layout: 'side-by-side',
    });
    lesson.focus(experiment, { emphasize: 'disagreement' });

    // one continuation, two verdicts
    expect(experiment.agreement).toBe('distinguished');
    expect(experiment.outcomes[0].verdict.polarity).toBe('reject'); // "01"
    expect(experiment.outcomes[1].verdict.polarity).toBe('accept'); // "1001"

    // the narration step mentions the tokens — recorded correspondence edges
    const say = world.timeline.root[1] as ActionStep;
    expect((say.payload as SayPayload).mentions).toEqual([x, y]);
    expect(world.graph.edgesOf(say).map((e) => e.b.id)).toEqual([x.id, y.id]);

    // the whole experiment replays in lockstep: both appends, then both verdicts
    const types = world.trace(experiment).map((e) => e.type);
    expect(types).toEqual([
      'append',
      'compare:apply',
      'append',
      'compare:apply',
      'compare:judge',
      'compare:judge',
    ]);

    // timeline: show · say · compareExperiment · focus
    expect(world.timeline.root.map((n) => (n as ActionStep).op)).toEqual([
      'show',
      'say',
      'compareExperiment',
      'focus',
    ]);
  });

  it('beat 2b — the probe table builds up column by column and its role-span links to the suffixes', () => {
    const { world, lesson, wordOf } = setup();
    const probe = probeContinuations(world, lesson, wordOf, ['', '0', '1', '01']);
    lesson.focus(probe.table, { emphasize: 'agreement' });

    // one role covers all occurrences: link the span to every suffix at once
    const suffixSpan = world.handle('span');
    lesson.link(suffixSpan, probe.suffixes, 'represents');
    for (const s of probe.suffixes) {
      expect(world.graph.reachable(suffixSpan, s, { rels: ['represents'] })).toBe(true);
    }

    // buildUp = a cascade of reveal steps, one column each, paced slow→fast
    const buildUp = world.timeline.root[1] as CascadeStep;
    expect(buildUp.type).toBe('cascade');
    expect(buildUp.iterations).toHaveLength(4);
    expect(buildUp.pace).toEqual({ start: 'slow', end: 'fast' });
    expect((buildUp.iterations[0]![0] as ActionStep).op).toBe('reveal');
  });

  it('beat 3 — the collapse: partition-morph routes every token into its bucket, and the stream never mints a third', () => {
    const { world, lesson, wordOf, partitionOf, view } = setup();
    const words = world.collection<Word>([wordOf(''), wordOf('0'), wordOf('1'), wordOf('11')]);
    const cloud = view('view:tokens', words.items);

    const classes = partitionOf(words.items);
    const buckets = view('view:partition', classes);

    lesson.show(cloud);
    const morph = lesson.morph(cloud, buckets, { preserveIdentity: true }) as ActionStep;

    // every token flies home: one route per word, one contributes-to hop each
    const { routes } = morph.payload as MorphPayload;
    expect(routes).toHaveLength(4);
    const byLabel = new Map(classes.map((c) => [c.id, c.label]));
    const landed = routes.map((r) => {
      expect(r.hops).toHaveLength(1);
      const hop = r.hops[0]!;
      if (hop.via !== 'edge') throw new Error('expected a correspondence hop');
      expect(hop.edge.rel).toBe('contributes-to');
      expect(hop.edge.origin).toBe('construction');
      return byLabel.get(r.to.id);
    });
    expect(landed).toEqual(['EVEN', 'EVEN', 'ODD', 'EVEN']);

    // the "infinitely many" idiom: a cascade of arrivals re-buckets, no third bucket
    const buckets2 = world.incremental(words, {
      init: (items) => new Set(items.map((w) => ones(w.text) % 2)),
      apply: (set, delta) => new Set([...set, ones(delta.item.text) % 2]),
    });
    const stream = lesson.cascade(
      ['10', '101', '111', '0000'],
      (text) => {
        const w = wordOf(text);
        lesson.show(w, { enterFrom: 'top' });
        words.add(w);
      },
      { pace: { start: 'slow', end: 'fast' } },
    );
    expect(stream.iterations).toHaveLength(4);
    for (const iteration of stream.iterations) {
      expect(iteration.map((n) => (n as ActionStep).op)).toEqual(['show', 'collection:add']);
    }
    expect(buckets2.value.size).toBe(2); // however long the stream runs
  });

  it('beat 4 — the reinterpretation: buckets morph into states and each edge demonstrates its own derivation', () => {
    const { world, lesson, wordOf, partitionOf, machineOf, view } = setup();
    const words = world.collection<Word>([wordOf(''), wordOf('0'), wordOf('1')]);
    const classes = partitionOf(words.items);
    const buckets = view('view:partition', classes);

    const machine = machineOf(classes);
    const graph = view('view:stategraph', machine.states);

    // buckets and graph project DIFFERENT objects; the morph is legal because
    // machine.of recorded class↔state counterpart-of edges at construction
    const morph = lesson.morph(buckets, graph, { preserveIdentity: true }) as ActionStep;
    const { routes } = morph.payload as MorphPayload;
    expect(routes).toHaveLength(2);
    for (const route of routes) {
      expect(route.hops).toHaveLength(1);
      const hop = route.hops[0]!;
      if (hop.via !== 'edge') throw new Error('expected a correspondence hop');
      expect(hop.edge.rel).toBe('counterpart-of');
    }

    // each edge remembers how it was derived; replay that derivation as the reveal
    const reveal = lesson.cascade(machine.edges, (e) => {
      lesson.demonstrate(e);
    });
    expect(reveal.iterations).toHaveLength(4);
    machine.edges.forEach((edge, i) => {
      const demo = reveal.iterations[i]![0] as CascadeStep;
      expect(demo.type).toBe('cascade');
      expect(demo.iterations).toHaveLength(1); // filtered to THIS edge's event
      const payload = (demo.iterations[0]![0] as ActionStep).payload as DemonstrateEventPayload;
      expect(payload.subject).toBe(edge);
      expect(payload.event.type).toBe('edge.derive');
      expect(payload.event['symbol']).toBe(edge.symbol);
      expect(payload.event['landed']).toBe(edge.toLabel);
    });

    // reading 0 keeps the class, reading 1 swaps — the machine precipitated out
    expect(machine.edges.map((e) => `${e.fromLabel}-${e.symbol}->${e.toLabel}`)).toEqual([
      'EVEN-0->EVEN',
      'EVEN-1->ODD',
      'ODD-0->ODD',
      'ODD-1->EVEN',
    ]);
  });
});
