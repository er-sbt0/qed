/**
 * demonstrate.test.ts — trace replay as choreography, per-subpart filtering
 * (the reserved `subject` trace-event field), looping, and loop supersession.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, CascadeStep, Handle, LoopStep } from '@math-ai/core';
import { createLesson } from './lesson.js';
import type { DemonstrateEventPayload } from './types.js';

interface Edge extends Handle<'edge'> {
  readonly from: string;
  readonly to: string;
  readonly symbol: string;
}

interface Machine extends Handle<'machine'> {
  readonly edges: readonly Edge[];
}

function setup() {
  const world = createWorld();
  const lesson = createLesson(world);
  let runs = 0;
  /** A machine whose per-edge trace events carry the reserved `subject` tag. */
  const machineOf = world.defineOp('machine.of', (ctx, labels: readonly string[]): Machine => {
    runs += 1;
    const edges = labels.map((label) => {
      const [from = '', symbol = '', to = ''] = label.split(' ');
      const edge = ctx.value('edge', { from, to, symbol });
      ctx.trace({ type: 'edge.derive', subject: edge, from, symbol, to });
      return edge;
    });
    return ctx.value('machine', { edges });
  });
  return { world, lesson, machineOf, runs: () => runs };
}

function eventPayloads(cascade: CascadeStep): DemonstrateEventPayload[] {
  return cascade.iterations.map((it) => (it[0] as ActionStep).payload as DemonstrateEventPayload);
}

describe('demonstrate — trace replay as choreography', () => {
  it('replays the whole trace of a derived value, one cascade iteration per event', () => {
    const { lesson, machineOf } = setup();
    const machine = machineOf(['E 0 E', 'E 1 O', 'O 0 O', 'O 1 E']);
    const step = lesson.demonstrate(machine, { pace: { start: 'slow' } }) as CascadeStep;
    expect(step.type).toBe('cascade');
    expect(step.pace).toEqual({ start: 'slow' });
    const payloads = eventPayloads(step);
    expect(payloads).toHaveLength(4);
    payloads.forEach((p, i) => {
      expect(p.subject).toBe(machine);
      expect(p.index).toBe(i);
      expect(p.total).toBe(4);
      expect(p.intensity).toBe('full');
      expect(p.event.type).toBe('edge.derive');
    });
    expect((step.iterations[0]![0] as ActionStep).op).toBe('demonstrate:event');
  });

  it('the trace is re-derived lazily — only when demonstrate runs', () => {
    const { lesson, machineOf, runs } = setup();
    const machine = machineOf(['E 1 O']);
    expect(runs()).toBe(1);
    lesson.demonstrate(machine);
    expect(runs()).toBe(2);
  });

  it('demonstrating a SUBPART filters to events tagged with its handle', () => {
    const { lesson, machineOf } = setup();
    const machine = machineOf(['E 0 E', 'E 1 O', 'O 1 E']);
    const oneEdge = machine.edges[1]!;
    const step = lesson.demonstrate(oneEdge) as CascadeStep;
    const payloads = eventPayloads(step);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.subject).toBe(oneEdge);
    expect(payloads[0]!.total).toBe(1);
    const event = payloads[0]!.event;
    expect(event['symbol']).toBe('1');
    expect((event['subject'] as Handle).id).toBe(oneEdge.id);
  });

  it('a value with no provenance raises a diagnostic', () => {
    const { world, lesson } = setup();
    const bare = world.handle('word');
    expect(() => lesson.demonstrate(bare)).toThrow(/carries no provenance record/);
  });
});

describe('demonstrate — {loop, intensity}', () => {
  it('loop wraps the replay in an open-ended LoopStep (times undefined)', () => {
    const { lesson, machineOf } = setup();
    const machine = machineOf(['E 1 O']);
    const step = lesson.demonstrate(machine, { loop: true, intensity: 'ambient' }) as LoopStep;
    expect(step.type).toBe('loop');
    expect(step.times).toBeUndefined(); // until superseded
    const inner = step.children[0] as CascadeStep;
    expect(inner.type).toBe('cascade');
    expect(eventPayloads(inner)[0]!.intensity).toBe('ambient');
    expect(lesson.ambientLoops).toContain(step);
  });
});

describe('loop supersession — who cancels an open-ended loop', () => {
  it('the next animating step on the same subject supersedes the loop', () => {
    const { lesson, machineOf } = setup();
    const machine = machineOf(['E 1 O']);
    const loop = lesson.demonstrate(machine, { loop: true, intensity: 'ambient' });
    expect(lesson.supersederOf(loop)).toBeUndefined();
    const focus = lesson.focus(machine, { emphasize: 'stillness' });
    expect(lesson.supersederOf(loop)).toBe(focus.id);
    expect(lesson.ambientLoops).not.toContain(loop);
  });

  it('annotation (say, link) does not supersede — narration accompanies ambient motion', () => {
    const { world, lesson, machineOf } = setup();
    const machine = machineOf(['E 1 O']);
    const loop = lesson.demonstrate(machine, { loop: true });
    lesson.say`Watch ${machine} run forever.`;
    lesson.link(world.handle('span'), machine, 'represents');
    expect(lesson.supersederOf(loop)).toBeUndefined();
    expect(lesson.ambientLoops).toContain(loop);
  });

  it('steps on unrelated subjects do not supersede', () => {
    const { world, lesson, machineOf } = setup();
    const machine = machineOf(['E 1 O']);
    const loop = lesson.demonstrate(machine, { loop: true });
    lesson.show(world.handle('view:bars'));
    expect(lesson.supersederOf(loop)).toBeUndefined();
  });

  it('a new ambient demonstrate on the same subject supersedes the previous loop', () => {
    const { lesson, machineOf } = setup();
    const machine = machineOf(['E 1 O']);
    const first = lesson.demonstrate(machine, { loop: true });
    const second = lesson.demonstrate(machine, { loop: true });
    expect(lesson.supersederOf(first)).toBe(second.id);
    expect(lesson.supersederOf(second)).toBeUndefined();
    expect(lesson.ambientLoops).toEqual([second]);
  });
});
