/**
 * green.compose.test.ts — does the vector-calculus vocabulary actually compose
 * into Green's theorem?
 *
 * The unit tests in field.test.ts prove the mathematics one primitive at a
 * time. This proves the thing those cannot: that a LESSON can be authored out
 * of them — beats, views, a traced sweep, a focus on the edges that cancel, and
 * a claim at the end — against the real program scope, without any primitive
 * needing a shim to reach the next one.
 *
 * It is deliberately NOT a fixture and NOT an example. `examples/` is recorded
 * model output (see CLAUDE.md) and a frozen fixture would make this program
 * content to preserve; what is worth keeping is the COMPOSITION check, which a
 * unit test expresses and neither of those does. The eventual `examples/green/`
 * comes from a billed `record`, and may look nothing like this.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, World } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import type { BeatPayload } from '@math-ai/lesson';
import { createProgramScope } from './scope.js';
import type { ProgramScope } from './scope.js';
import type { CirculationWalk, OrientedLoop, TilingWalk } from './field.js';

let world: World;
let scope: ProgramScope;
const authored: {
  loop?: OrientedLoop;
  walk?: CirculationWalk;
  sweep?: TilingWalk;
  around?: number;
  summed?: number;
  claimHolds?: boolean;
} = {};

beforeAll(() => {
  world = createWorld();
  scope = createProgramScope(world, createStage(world));
  const { M, Field, View, Layout, lesson, Interaction } = scope;

  // ── the program, as a lesson would author it ──

  const spin = M.parameter('spin', 1, { range: [-2, 2] });
  const F = Field.vectorField((x, y) => [-spin.value * y, spin.value * x], { label: 'F' });

  lesson.beat('A field that swirls');
  const fieldView = View.field(F, { domain: [-2, 2] });
  lesson.show(fieldView);

  lesson.beat('Walk the boundary');
  const R = Field.rectangle({ x0: -1, y0: -1, x1: 1, y1: 1, label: '\\Omega' });
  const boundary = R.boundary;
  lesson.show(Layout.overlay([fieldView, View.loop(boundary)]));
  const walk = Field.walk(F, boundary);
  lesson.demonstrate(walk, { pace: { start: 'slow', end: 'fast' } });
  const around = Field.circulation(F, boundary);
  lesson.show(View.readout(around, { label: '\\oint_{\\partial\\Omega} F\\cdot dr' }));

  lesson.beat('Cut it into cells');
  const T = Field.tile(R, { n: 4 });
  lesson.show(View.tiling(T, { cellsMode: 'deferred' }));
  const sweep = Field.walkTiles(F, T);
  lesson.demonstrate(sweep);

  lesson.beat('The inside cancels');
  // the crown jewel, used exactly as designed: focus the shared edges, and
  // separately the ones that survive
  lesson.focus(T.interiorEdges[0]!, { emphasize: 'disagreement' });
  lesson.focus(T.boundaryEdges, { emphasize: 'stillness' });

  lesson.beat('Where the swirl lives');
  lesson.show(View.heatmap(Field.curl(F), { domain: [-2, 2] }));

  lesson.beat('Try to break it');
  const summed = M.derived(
    () => T.tiles.reduce((s, t) => s + Field.circulation(F, t.boundary).value, 0),
    '\\sum_{cells}',
  );
  const green = M.claim({
    lhs: around,
    rhs: summed,
    relation: '≈',
    tolerance: 1e-6,
    label: '\\oint_{\\partial\\Omega} F\\cdot dr = \\iint_\\Omega \\text{curl}\\,F',
  });
  lesson.show(View.claim(green));
  lesson.expose(spin, { as: 'draggable' });
  lesson.enableInteraction(Interaction.drag(spin, { along: fieldView }));

  authored.loop = boundary;
  authored.walk = walk;
  authored.sweep = sweep;
  authored.around = around.value;
  authored.summed = summed.value;
  authored.claimHolds = green.holds;

  // the student's drag — the claim must survive it
  spin.setValueLive(-1.7);
  authored.claimHolds = authored.claimHolds === true && green.holds;
  spin.setValueLive(0);
  authored.claimHolds = authored.claimHolds === true && green.holds;
});

describe('a Green lesson, authored against the real scope', () => {
  it('runs to completion and lays down its beats in order', () => {
    const beats = world.timeline.root
      .filter((n): n is ActionStep => n.type === 'action' && n.op === 'beat')
      .map((n) => n.payload as BeatPayload);
    expect(beats.map((b) => b.title)).toEqual([
      'A field that swirls',
      'Walk the boundary',
      'Cut it into cells',
      'The inside cancels',
      'Where the swirl lives',
      'Try to break it',
    ]);
  });

  it('the traced walk gives demonstrate one event per boundary edge', () => {
    expect(authored.walk!.contributions).toHaveLength(4);
    expect(world.trace(authored.walk!).filter((e) => e.type === 'contribution:derive')).toHaveLength(4);
  });

  it('the traced sweep gives demonstrate one event per cell', () => {
    expect(authored.sweep!.cells).toHaveLength(16);
    expect(world.trace(authored.sweep!).filter((e) => e.type === 'tile:derive')).toHaveLength(16);
  });

  it('the cells sum to the boundary — the theorem, as the lesson states it', () => {
    expect(Math.abs(authored.summed! - authored.around!)).toBeLessThan(1e-9);
  });

  it('the claim survives every drag the student can make — it is a theorem', () => {
    expect(authored.claimHolds).toBe(true);
  });
});
