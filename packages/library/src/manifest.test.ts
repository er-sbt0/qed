/**
 * manifest.test.ts — can a follow-up question be answered from the manifest?
 *
 * The exit criterion roadmap step 4a states is a model correctly answering
 * "why did that turn red?" about a STUDENT-MODIFIED claim, naming existing
 * handles. That last clause is the part a free test can pin, and it is the
 * part that actually decides whether the billed run can succeed: if the
 * manifest does not carry the dragged value, the flipped verdict, and the ids,
 * no prompt can rescue it.
 *
 * So these assert the manifest's obligations, not a model's prose.
 *
 * It lives in @math-ai/library rather than beside manifest.ts because the
 * dependency runs library -> render, so only this side can build a real
 * program scope to describe. Same reason green.compose.test.ts is here.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { World } from '@math-ai/core';
import { createStage, sceneManifest, transitionFeed } from '@math-ai/render';
import type { SceneManifest } from '@math-ai/render';
import { createProgramScope } from './scope.js';
import type { ProgramScope } from './scope.js';

let world: World;
let scope: ProgramScope;
let spin: ReturnType<ProgramScope['M']['parameter']>;
let conjecture: ReturnType<ProgramScope['M']['claim']>;
let circulation: { id: string; value: number };

/** A small scene with one draggable, one theorem and one breakable conjecture. */
beforeEach(() => {
  world = createWorld();
  scope = createProgramScope(world, createStage(world));
  const { M, Field, View, lesson, Interaction } = scope;

  spin = M.parameter('spin', 1, { range: [-2, 2] });
  const F = Field.vectorField((x: number, y: number) => [-spin.value * y, spin.value * x] as const, { label: 'F' });
  const omega = Field.rectangle({ x0: -1, y0: -1, x1: 1, y1: 1, label: '\\Omega' });

  lesson.beat('A field that swirls');
  const fieldView = View.field(F, { over: omega });
  lesson.show(fieldView);
  lesson.say`The field turns with ${spin}.`;

  lesson.beat('Two propositions');
  const around = Field.circulation(F, omega.boundary);
  circulation = around;
  lesson.show(View.readout(around, { label: 'circulation' }));

  // a theorem: the area of Ω does not care what the field does
  lesson.show(
    View.claim(M.claim({ lhs: omega.area, rhs: 4, relation: '≈', label: 'the region is 4 wide' })),
  );
  // a conjecture the student can break by dragging spin
  conjecture = M.claim({
    predicate: () => around.value > 0,
    label: 'the circulation runs counterclockwise',
  });
  lesson.show(View.claim(conjecture));

  lesson.expose(spin, { as: 'draggable' });
  lesson.enableInteraction(Interaction.drag(spin, { along: fieldView }));
});

const manifest = (): SceneManifest => sceneManifest(scope.stage);

describe('sceneManifest — what the scene NOW is', () => {
  it('lists the beats in order', () => {
    expect(manifest().beats.map((b) => b.title)).toEqual([
      'A field that swirls',
      'Two propositions',
    ]);
  });

  it('carries the prose the student was actually shown', () => {
    expect(manifest().narration.join(' ')).toContain('The field turns with');
  });

  it('names the draggable parameter, with its range and current value', () => {
    const p = manifest().objects.find((o) => o.label === 'spin');
    expect(p).toBeDefined();
    expect(p!.value).toBe(1);
    expect(p!.range).toEqual([-2, 2]);
    expect(p!.draggable).toBe(true);
  });

  /** The whole point of a manifest over the program text. */
  it('reports the STUDENT-dragged value, not the authored one', () => {
    expect(manifest().objects.find((o) => o.label === 'spin')!.value).toBe(1);
    spin.setValueLive(-1.5);
    expect(manifest().objects.find((o) => o.label === 'spin')!.value).toBe(-1.5);
  });

  it('reports a claim that the drag BROKE, and everything needed to explain it', () => {
    const before = manifest().claims.find((c) => c.id === conjecture.id)!;
    expect(before.holds).toBe(true);

    spin.setValueLive(-1.5); // reverse the swirl: the circulation goes negative

    const after = manifest().claims.find((c) => c.id === conjecture.id)!;
    expect(after.holds).toBe(false);
    expect(after.label).toBe('the circulation runs counterclockwise');
    // and the quantity it depends on moved with it, so a follow-up can point
    // at the cause and not just the symptom
    const flow = manifest().objects.find((o) => o.id === circulation.id);
    expect(flow).toBeDefined();
    expect(flow!.value as number).toBeLessThan(0);
  });

  /**
   * The dishonesty roadmap 4a exists to stop: a predicate closure's opinion
   * and an engine comparison must not read the same in the prompt.
   */
  it('labels HOW each claim was judged', () => {
    const claims = manifest().claims;
    const predicate = claims.find((c) => c.id === conjecture.id)!;
    expect(predicate.evidence).toBe('authored-predicate');

    const compared = claims.find((c) => c.label === 'the region is 4 wide')!;
    expect(compared.evidence).toBe('sampled'); // relation ≈ — agreement, not proof
    expect(compared.lhs).toBe(4);
    expect(compared.gap).toBeCloseTo(0, 9);
  });

  it('exact comparisons are labeled as such, and tolerated ones are not', () => {
    const { M, lesson, View } = scope;
    const a = M.parameter('a', 2, { range: [0, 4] });
    const exact = M.claim({ lhs: a, rhs: 2, label: 'a = 2' });
    const slack = M.claim({ lhs: a, rhs: 2, tolerance: 0.5, label: 'a is about 2' });
    lesson.show(View.claim(exact));
    lesson.show(View.claim(slack));
    const claims = manifest().claims;
    expect(claims.find((c) => c.id === exact.id)!.evidence).toBe('exact-comparison');
    expect(claims.find((c) => c.id === slack.id)!.evidence).toBe('sampled');
  });

  it('lists the views, what they project, and whether they have been shown', () => {
    const views = manifest().views;
    expect(views.some((v) => v.kind === 'view:field')).toBe(true);
    expect(views.some((v) => v.kind === 'view:claim')).toBe(true);
    // nothing has been played, so nothing is shown yet — the manifest reports
    // the truth rather than what the program asked for.
    expect(views.every((v) => v.shown === false)).toBe(true);
  });

  it('every object it names has an id a follow-up can reference back', () => {
    const m = manifest();
    for (const o of [...m.objects, ...m.claims, ...m.views]) {
      expect(typeof o.id).toBe('string');
      expect(o.id.length).toBeGreaterThan(0);
    }
    // and the ids are unique across the object list
    const ids = m.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops objects with nothing live and nothing movable — a prompt is not a heap dump', () => {
    for (const o of manifest().objects) {
      expect(o.value !== undefined || o.range !== undefined || o.draggable === true).toBe(true);
    }
  });
});

describe('transitionFeed — since the last question (roadmap 4c)', () => {
  it('one drag that breaks the conjecture is one labeled move and one flip', () => {
    const before = manifest();
    spin.setValueLive(-1.5); // reverse the swirl
    const after = manifest();

    // the move arrives pre-coalesced from the log (studentEvents ∘ coalesce,
    // proven in the host package) — here the seam's shape is what is under test
    const feed = transitionFeed(before, after, [{ target: spin.id, value: -1.5 }]);

    expect(feed.moved).toEqual([{ target: spin.id, value: -1.5, label: 'spin' }]);
    // ONLY the conjecture flipped; the theorem about the area kept quiet
    expect(feed.flipped).toEqual([
      { id: conjecture.id, label: 'the circulation runs counterclockwise', from: true, to: false },
    ]);
  });
});
