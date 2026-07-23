/**
 * verbs.test.ts — unit tests for the simple verbs: say, beat, show, hide,
 * focus, link, vary, expose, cascade, parallel, buildUp. (morph, demonstrate,
 * and compareExperiment have their own files.)
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, CascadeStep, Handle, ParallelStep, World } from '@math-ai/core';
import { createLesson } from './lesson.js';
import type {
  BeatPayload,
  ExposePayload,
  FocusPayload,
  HidePayload,
  LinkPayload,
  RevealPayload,
  SayPayload,
  ShowPayload,
  VaryPayload,
  VarySettable,
} from './types.js';

function setup() {
  const world = createWorld();
  const lesson = createLesson(world);
  return { world, lesson };
}

function lastAction(world: World): ActionStep {
  const node = world.timeline.root[world.timeline.root.length - 1];
  if (node?.type !== 'action') throw new Error(`expected an action step, got ${node?.type}`);
  return node;
}

describe('createLesson', () => {
  it('binds one lesson per world', () => {
    const world = createWorld();
    createLesson(world);
    expect(() => createLesson(world)).toThrow(/one lesson per world/);
  });
});

describe('say', () => {
  it('enqueues a say step carrying the template segments and mentions', () => {
    const { world, lesson } = setup();
    const w = world.handle('word');
    const step = lesson.say`Compare ${w} against ${3} or ${'plain text'}.`;
    expect(step).toBe(lastAction(world));
    const payload = lastAction(world).payload as SayPayload;
    expect(payload.strings).toEqual(['Compare ', ' against ', ' or ', '.']);
    expect(payload.mentions).toEqual([w, 3, 'plain text']);
  });

  it('records interpolated handles as represents edges on the narration step', () => {
    const { world, lesson } = setup();
    const a = world.handle('word');
    const b = world.handle('class');
    const step = lesson.say`${a} lands in ${b}, always.`;
    const edges = world.graph.edgesOf(step);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => [e.b.id, e.rel, e.origin])).toEqual([
      [a.id, 'represents', 'construction'],
      [b.id, 'represents', 'construction'],
    ]);
  });

  it('records nothing for string/number mentions', () => {
    const { world, lesson } = setup();
    const step = lesson.say`Just ${42} and ${'words'}.`;
    expect(world.graph.edgesOf(step)).toHaveLength(0);
  });
});

describe('beat', () => {
  it('enqueues a flat action step carrying the title, in call order', () => {
    const { world, lesson } = setup();
    const v = world.handle('view:tokens');
    const step = lesson.beat('Set up the alphabet');
    lesson.show(v);
    expect(step).toBe(world.timeline.root[0]);
    const action = world.timeline.root[0] as ActionStep;
    expect(action.type).toBe('action'); // a marker, not a container
    expect(action.op).toBe('beat');
    expect(action.payload as BeatPayload).toEqual({ title: 'Set up the alphabet', index: 0 });
    expect((world.timeline.root[1] as ActionStep).op).toBe('show');
  });

  it('numbers beats 0-based in declaration order', () => {
    const { world, lesson } = setup();
    lesson.beat('first');
    lesson.say`in between`;
    lesson.beat('second');
    lesson.beat('third');
    const beats = world.timeline.root
      .filter((node): node is ActionStep => node.type === 'action' && node.op === 'beat')
      .map((node) => node.payload as BeatPayload);
    expect(beats).toEqual([
      { title: 'first', index: 0 },
      { title: 'second', index: 1 },
      { title: 'third', index: 2 },
    ]);
  });

  it('counts per lesson, not per world-global', () => {
    const a = setup();
    const b = setup();
    a.lesson.beat('a0');
    b.lesson.beat('b0');
    expect((lastAction(a.world).payload as BeatPayload).index).toBe(0);
    expect((lastAction(b.world).payload as BeatPayload).index).toBe(0);
  });

  it('is annotation-class: a boundary does not supersede an open ambient loop', () => {
    const { world, lesson } = setup();
    const derive = world.defineOp('bars.of', (ctx, n: number) => {
      ctx.trace({ type: 'bars.step', n });
      return ctx.value('bars', { n });
    });
    const bars = derive(3);
    const loop = lesson.demonstrate(bars, { loop: true, intensity: 'ambient' });
    expect(lesson.supersederOf(loop)).toBeUndefined();

    lesson.beat('Now watch what stays put');
    // the student is parked at the boundary — the ambient motion keeps running
    expect(lesson.supersederOf(loop)).toBeUndefined();
    expect(lesson.ambientLoops).toContain(loop);

    const focus = lesson.focus(bars, { emphasize: 'stillness' });
    expect(lesson.supersederOf(loop)).toBe(focus.id); // a real animating step ends it
  });
});

describe('show / hide / focus', () => {
  it('show carries subject and options; pace lands on the step', () => {
    const { world, lesson } = setup();
    const v = world.handle('view:tokens');
    const step = lesson.show(v, { enterFrom: 'top', fadeAfter: '2s', pace: { start: 'slow' } });
    const action = lastAction(world);
    expect(step).toBe(action);
    expect(action.op).toBe('show');
    expect(action.payload as ShowPayload).toEqual({ subject: v, enterFrom: 'top', fadeAfter: '2s' });
    expect(action.pace).toEqual({ start: 'slow' });
  });

  it('hide carries the subject', () => {
    const { world, lesson } = setup();
    const v = world.handle('view:tokens');
    lesson.hide(v);
    const action = lastAction(world);
    expect(action.op).toBe('hide');
    expect((action.payload as HidePayload).subject).toBe(v);
  });

  it('focus normalizes a single subject to a one-element array', () => {
    const { world, lesson } = setup();
    const v = world.handle('experiment');
    lesson.focus(v, { emphasize: 'disagreement' });
    const payload = lastAction(world).payload as FocusPayload;
    expect(payload.subjects).toEqual([v]);
    expect(payload.emphasize).toBe('disagreement');
  });

  it('focus accepts an array of subjects and the stillness emphasis', () => {
    const { world, lesson } = setup();
    const a = world.handle('view:bars');
    const b = world.handle('view:matrix');
    lesson.focus([a, b], { emphasize: 'stillness' });
    const payload = lastAction(world).payload as FocusPayload;
    expect(payload.subjects).toEqual([a, b]);
    expect(payload.emphasize).toBe('stillness');
  });
});

describe('link', () => {
  it('authors an edge and enqueues a link step carrying it', () => {
    const { world, lesson } = setup();
    const span = world.handle('span');
    const word = world.handle('word');
    lesson.link(span, word, 'represents');
    const payload = lastAction(world).payload as LinkPayload;
    expect(payload.a).toBe(span);
    expect(payload.targets).toEqual([word]);
    expect(payload.rel).toBe('represents');
    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0]!.origin).toBe('authored');
    expect(world.graph.reachable(span, word)).toBe(true);
  });

  it('accepts an array on the right — one edge per target', () => {
    const { world, lesson } = setup();
    const span = world.handle('span');
    const targets = [world.handle('word'), world.handle('word'), world.handle('word')];
    lesson.link(span, targets, 'represents');
    const payload = lastAction(world).payload as LinkPayload;
    expect(payload.targets).toEqual(targets);
    expect(payload.edges).toHaveLength(3);
    for (const t of targets) expect(world.graph.reachable(span, t)).toBe(true);
  });
});

describe('vary', () => {
  function cell(world: World, initial: number): VarySettable & { readonly log: number[] } {
    let value = initial;
    const log: number[] = [];
    return Object.freeze({
      ...world.handle('matrix:cell'),
      get value() {
        return value;
      },
      setValue(next: number) {
        value = next;
        log.push(next);
      },
      log,
    });
  }

  it('advances a VarySettable target immediately and records the transition', () => {
    const { world, lesson } = setup();
    const c = cell(world, 0.5);
    lesson.vary(c, { to: 1, over: '2s' });
    expect(c.value).toBe(1); // authoring-time reads see the post-vary value
    const payload = lastAction(world).payload as VaryPayload;
    expect(payload).toMatchObject({ target: c, from: 0.5, to: 1, over: '2s', applied: true });
  });

  it('still enqueues a declarative step for targets without setValue', () => {
    const { world, lesson } = setup();
    const readonlyHandle = Object.freeze({ ...world.handle('param'), value: 3 });
    lesson.vary(readonlyHandle, { to: 7 });
    expect(readonlyHandle.value).toBe(3);
    const payload = lastAction(world).payload as VaryPayload;
    expect(payload).toMatchObject({ from: 3, to: 7, applied: false });
  });
});

describe('expose', () => {
  it('binds the subject as user-interactive in the payload', () => {
    const { world, lesson } = setup();
    const matrix = world.handle('view:matrix');
    lesson.expose(matrix, { as: 'draggable' });
    const action = lastAction(world);
    expect(action.op).toBe('expose');
    expect(action.payload as ExposePayload).toEqual({ subject: matrix, as: 'draggable' });
  });
});

describe('cascade / parallel — thin over the core timeline', () => {
  it('cascade groups per-item steps sequentially with pace', () => {
    const { world, lesson } = setup();
    const items = ['a', 'b', 'c'];
    const step = lesson.cascade(
      items,
      (item) => {
        lesson.say`item ${item}`;
      },
      { pace: { start: 'slow', end: 'fast' } },
    );
    expect(step.type).toBe('cascade');
    expect(step.iterations).toHaveLength(3);
    expect(step.pace).toEqual({ start: 'slow', end: 'fast' });
    for (const iteration of step.iterations) {
      expect((iteration[0] as ActionStep).op).toBe('say');
    }
  });

  it('parallel groups concurrent children', () => {
    const { world, lesson } = setup();
    const a = world.handle('view:bars');
    const step = lesson.parallel(() => {
      lesson.focus(a, { emphasize: 'stillness' });
      lesson.hide(a);
    });
    expect(step.type).toBe('parallel');
    expect((step as ParallelStep).children.map((c) => (c as ActionStep).op)).toEqual([
      'focus',
      'hide',
    ]);
    // grouped children do not also appear at the root
    expect(world.timeline.root).toHaveLength(1);
  });
});

describe('buildUp', () => {
  it('reveals groups from the BuildUpSubject protocol as a cascade of reveal steps', () => {
    const { world, lesson } = setup();
    const cols = [world.handle('table:col'), world.handle('table:col')];
    const table = Object.freeze({
      ...world.handle('view:table'),
      buildUpGroups: (order: string) => (order === 'column-by-column' ? cols.map((c) => [c]) : []),
    });
    const step = lesson.buildUp(table, {
      order: 'column-by-column',
      pace: { start: 'slow', end: 'fast' },
    });
    expect(step.type).toBe('cascade');
    expect(step.iterations).toHaveLength(2);
    step.iterations.forEach((iteration, i) => {
      const reveal = iteration[0] as ActionStep;
      expect(reveal.op).toBe('reveal');
      expect(reveal.payload as RevealPayload).toEqual({
        subject: table,
        parts: [cols[i]],
        index: i,
        order: 'column-by-column',
      });
    });
  });

  it('explicit groups override the protocol', () => {
    const { world, lesson } = setup();
    const rows = [[world.handle('table:row')], [world.handle('table:row')]];
    const table = world.handle('view:table');
    const step: CascadeStep = lesson.buildUp(table, { order: 'row-by-row', groups: rows });
    expect(step.iterations).toHaveLength(2);
    expect((step.iterations[1]![0] as ActionStep).payload as RevealPayload).toMatchObject({
      parts: rows[1],
      index: 1,
    });
  });

  it('raises a diagnostic when the subject exposes no subparts', () => {
    const { world, lesson } = setup();
    const bare = world.handle('view:table');
    expect(() => lesson.buildUp(bare, { order: 'cell-by-cell' })).toThrow(
      /does not implement buildUpGroups\("cell-by-cell"\)/,
    );
  });
});
