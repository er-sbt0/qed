/**
 * compare.test.ts — compareExperiment: lockstep execution through a core op,
 * typed verdicts, agreement, and replayability of the whole comparison.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, Handle } from '@math-ai/core';
import { createLesson } from './lesson.js';
import type { CompareExperimentPayload, Verdict } from './types.js';

interface Word extends Handle<'word'> {
  readonly text: string;
}

function setup() {
  const world = createWorld();
  const lesson = createLesson(world);
  const wordOf = world.defineOp('word.of', (ctx, text: string): Word => ctx.value('word', { text }));
  const append = world.defineOp('word.append', (ctx, base: Word, suffix: string): Word => {
    const result = ctx.value('word', { text: base.text + suffix });
    ctx.trace({ type: 'append', subject: result, base: base.text, suffix });
    return result;
  });
  const evenOnes = (w: Word): Verdict =>
    (w.text.match(/1/g)?.length ?? 0) % 2 === 0
      ? { label: 'ACCEPT', polarity: 'accept' }
      : { label: 'REJECT', polarity: 'reject' };
  return { world, lesson, wordOf, append, evenOnes };
}

describe('compareExperiment', () => {
  it('applies one closure per subject and returns typed outcomes', () => {
    const { lesson, wordOf, append, evenOnes } = setup();
    const x = wordOf('0');
    const y = wordOf('100');
    const experiment = lesson.compareExperiment({
      subjects: [x, y],
      apply: (h) => append(h, '1'),
      judge: evenOnes,
      layout: 'side-by-side',
    });
    expect(experiment.kind).toBe('experiment');
    expect(experiment.outcomes).toHaveLength(2);
    const [first, second] = experiment.outcomes;
    expect(first.subject).toBe(x);
    expect(first.result.text).toBe('01'); // one 1 — odd
    expect(first.verdict).toEqual({ label: 'REJECT', polarity: 'reject' });
    expect(second.subject).toBe(y);
    expect(second.result.text).toBe('1001'); // two 1s — even
    expect(second.verdict).toEqual({ label: 'ACCEPT', polarity: 'accept' });
    expect(experiment.agreement).toBe('distinguished');
  });

  it('identical verdicts agree', () => {
    const { lesson, wordOf, append, evenOnes } = setup();
    const experiment = lesson.compareExperiment({
      subjects: [wordOf('0'), wordOf('00')],
      apply: (h) => append(h, '11'),
      judge: evenOnes,
    });
    expect(experiment.agreement).toBe('agree');
    expect(experiment.outcomes[0].verdict.polarity).toBe('accept');
    expect(experiment.outcomes[1].verdict.polarity).toBe('accept');
  });

  it('judge receives the SUBJECT too (the stationarity signature)', () => {
    const { lesson, wordOf, append } = setup();
    const fixed = lesson.compareExperiment({
      subjects: [wordOf('a'), wordOf('b')],
      apply: (h) => append(h, ''),
      judge: (result, subject): Verdict =>
        result.text === subject.text
          ? { label: 'UNCHANGED', polarity: 'accept' }
          : { label: 'MOVED', polarity: 'reject' },
    });
    expect(fixed.outcomes.map((o) => o.verdict.label)).toEqual(['UNCHANGED', 'UNCHANGED']);
    expect(fixed.agreement).toBe('agree');
  });

  it('enqueues a compareExperiment step carrying the experiment and layout', () => {
    const { world, lesson, wordOf, append, evenOnes } = setup();
    const x = wordOf('0');
    const y = wordOf('1');
    const experiment = lesson.compareExperiment({
      subjects: [x, y],
      apply: (h) => append(h, '1'),
      judge: evenOnes,
    });
    const last = world.timeline.root[world.timeline.root.length - 1] as ActionStep;
    expect(last.op).toBe('compareExperiment');
    const payload = last.payload as CompareExperimentPayload;
    expect(payload.experiment).toBe(experiment);
    expect(payload.subjects).toEqual([x, y]);
    expect(payload.layout).toBe('side-by-side'); // the default
  });

  it('the experiment came-from its subjects (auto edges)', () => {
    const { world, lesson, wordOf, append, evenOnes } = setup();
    const x = wordOf('0');
    const y = wordOf('1');
    const experiment = lesson.compareExperiment({
      subjects: [x, y],
      apply: (h) => append(h, '1'),
      judge: evenOnes,
    });
    expect(world.graph.reachable(experiment, x, { rels: ['came-from'] })).toBe(true);
    expect(world.graph.reachable(experiment, y, { rels: ['came-from'] })).toBe(true);
  });

  it('demonstrate(experiment) replays both derivations in lockstep', () => {
    const { world, lesson, wordOf, append, evenOnes } = setup();
    const x = wordOf('0');
    const y = wordOf('100');
    const experiment = lesson.compareExperiment({
      subjects: [x, y],
      apply: (h) => append(h, '1'),
      judge: evenOnes,
    });
    const events = world.trace(experiment);
    // nested append events interleave with the compare markers, per side, in order
    expect(events.map((e) => `${e.type}${'side' in e ? `:${e['side']}` : ''}`)).toEqual([
      'append',
      'compare:apply:0',
      'append',
      'compare:apply:1',
      'compare:judge:0',
      'compare:judge:1',
    ]);
    // and the verdict events carry the typed verdicts
    expect((events[4]!['verdict'] as Verdict).polarity).toBe('reject');
    expect((events[5]!['verdict'] as Verdict).polarity).toBe('accept');
  });

  it('apply must be pure — mutating a slot inside it throws', () => {
    const { world, lesson, wordOf, append, evenOnes } = setup();
    const s = world.slot(0);
    expect(() =>
      lesson.compareExperiment({
        subjects: [wordOf('a'), wordOf('b')],
        apply: (h) => {
          s.set(1);
          return append(h, '1');
        },
        judge: evenOnes,
      }),
    ).toThrow(/not allowed inside an operation body/);
  });
});
