/**
 * player.test.ts — segmented playback, headless (a Stage with no container:
 * views never touch the DOM, but every step still executes).
 *
 * What is asserted here is the navigation CONTRACT, not the pixels:
 *   · `play()` still walks the whole timeline (the old entry point),
 *   · `next()` plays exactly one beat and parks,
 *   · `seek()` fast-forwards silently — steps execute, no time passes,
 *   · a `vary` skipped by a fast-forward still lands on its recorded value,
 *   · an ambient loop superseded inside a skipped beat is NOT running on
 *     arrival; one that was never superseded IS.
 */
import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { Handle, TimelineNode } from '@math-ai/core';
import { createLesson } from '@math-ai/lesson';
import type { VarySettable } from '@math-ai/lesson';
import { createStage } from './stage.js';
import { createPlayer } from './player.js';

const opsOf = (nodes: readonly TimelineNode[]): string[] =>
  nodes.map((n) => (n.type === 'action' ? n.op : n.type));

function scene() {
  const world = createWorld();
  const lesson = createLesson(world);
  const stage = createStage(world); // headless
  return { world, lesson, stage };
}

/** A numeric cell that records what was written to it. */
function cell(world: ReturnType<typeof createWorld>, initial: number): VarySettable & { readonly seen: number[] } {
  const seen: number[] = [];
  let v = initial;
  return {
    ...world.handle('cell'),
    get value() {
      return v;
    },
    setValue(next: number) {
      v = next;
      seen.push(next);
    },
    setValueLive(next: number) {
      v = next;
      seen.push(next);
    },
    seen,
  };
}

describe('Player segmentation', () => {
  it('reports the beats it can navigate', () => {
    const { lesson, stage } = scene();
    lesson.say`prologue`;
    lesson.beat('one');
    lesson.say`a`;
    lesson.beat('two');
    lesson.say`b`;
    const player = createPlayer(stage, lesson);
    expect(player.segmentCount).toBe(3);
    expect(player.titles).toEqual([undefined, 'one', 'two']);
    expect(player.segmentIndex).toBe(-1);
    expect(player.status).toBe('idle');
  });

  it('play() still walks the whole timeline, beats and all', async () => {
    const { lesson, stage, world } = scene();
    lesson.say`a`;
    lesson.beat('one');
    lesson.show(world.handle('thing'));
    const seen: TimelineNode[] = [];
    const player = createPlayer(stage, lesson, { speed: 40, onStep: (n) => seen.push(n) });
    await player.play();
    expect(opsOf(seen)).toEqual(opsOf(world.timeline.root));
    expect(player.status).toBe('done');
    expect(player.atEnd).toBe(true);
  });

  it('next() plays one beat and parks at its boundary', async () => {
    const { lesson, stage } = scene();
    lesson.beat('one');
    lesson.say`a`;
    lesson.beat('two');
    lesson.say`b`;
    const events: string[] = [];
    const player = createPlayer(stage, lesson, {
      speed: 40,
      onSegment: (e) => events.push(`${e.phase}:${e.index}:${e.instant ? 'ff' : 'play'}`),
    });

    expect(await player.next()).toBe(true);
    expect(player.segmentIndex).toBe(0);
    expect(player.status).toBe('paused');
    expect(player.isAnimating).toBe(false);

    expect(await player.next()).toBe(true);
    expect(player.segmentIndex).toBe(1);
    expect(player.status).toBe('done');

    expect(await player.next()).toBe(false); // nothing left
    expect(events).toEqual([
      'start:0:play',
      'end:0:play',
      'start:1:play',
      'end:1:play',
    ]);
  });

  it('seek() fast-forwards the earlier beats without spending time', async () => {
    const { lesson, stage } = scene();
    for (let i = 0; i < 4; i += 1) {
      lesson.beat(`beat ${i}`);
      lesson.say`slow narration ${i}`;
      lesson.say`more narration ${i}`;
    }
    const instants: number[] = [];
    // speed 40 is as fast as the `speed` divisor can go — ms() floors at 24ms
    // per step, so these six says still cost ~150ms when merely SPED UP. The
    // fast-forward must cost none of it: that is why instant mode is a flag.
    const player = createPlayer(stage, lesson, {
      speed: 40,
      onSegment: (e) => {
        if (e.phase === 'start' && e.instant) instants.push(e.index);
      },
    });
    const t0 = Date.now();
    await player.fastForward(3); // segments 0,1,2 — six says
    const elapsed = Date.now() - t0;
    expect(instants).toEqual([0, 1, 2]);
    expect(elapsed).toBeLessThan(100);
    expect(player.segmentIndex).toBe(2);
    expect(await player.next()).toBe(true); // the target beat plays normally
    expect(player.segmentIndex).toBe(3);
  });

  it('refuses to seek backward — going back means rebuilding the world', async () => {
    const { lesson, stage } = scene();
    lesson.beat('one');
    lesson.beat('two');
    lesson.beat('three');
    const player = createPlayer(stage, lesson, { speed: 40 });
    await player.seek(2);
    expect(player.segmentIndex).toBe(2);
    await expect(player.seek(1)).rejects.toThrow(/cannot seek backward/);
  });

  it('a vary skipped by a fast-forward still lands on its recorded value', async () => {
    const { lesson, stage, world } = scene();
    const c = cell(world, 0.1);
    lesson.beat('setup');
    lesson.say`before`;
    lesson.beat('trap the walker');
    lesson.vary(c, { to: 1, over: '2s' });
    lesson.beat('after');
    lesson.say`after`;

    expect(c.value).toBe(1); // authoring already applied it
    const player = createPlayer(stage, lesson, { speed: 40 });
    player.init();
    expect(c.value).toBe(0.1); // ...and init rewound it for replay

    await player.seek(2);
    expect(c.value).toBe(1); // the skipped vary replayed instantly, and landed
  });
});

describe('Player ambient loops across a fast-forward', () => {
  /** A traced value whose demonstration pulses (headless-observable). */
  function loopScene(supersede: boolean) {
    const { world, lesson, stage } = scene();
    const pulseOp = world.defineOp('flow.of', (ctx): Handle => {
      const out: Handle = ctx.value('flow', {});
      ctx.trace({ type: 'ping', subject: out });
      return out;
    });
    const flow = pulseOp();
    lesson.beat('one');
    lesson.say`a`;
    lesson.beat('the picture breathes');
    lesson.demonstrate(flow, { loop: true, intensity: 'ambient' });
    lesson.beat('then');
    if (supersede) lesson.hide(flow);
    else lesson.say`still breathing`;
    const lit = vi.fn();
    stage.lightUp = lit;
    return { stage, lesson, lit };
  }

  const breathe = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a loop superseded inside a skipped beat is not running on arrival', async () => {
    const { stage, lesson, lit } = loopScene(true);
    const player = createPlayer(stage, lesson, { speed: 40 });
    await player.fastForward(3);
    lit.mockClear();
    await breathe(120);
    expect(lit).not.toHaveBeenCalled();
    player.stopAmbient();
  });

  it('a loop whose superseder never fired IS running on arrival', async () => {
    const { stage, lesson, lit } = loopScene(false);
    const player = createPlayer(stage, lesson, { speed: 40 });
    await player.fastForward(3);
    lit.mockClear();
    await breathe(120);
    expect(lit).toHaveBeenCalled();
    player.stopAmbient();
  });
});
