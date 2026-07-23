/**
 * secondderivative.compose.test.ts — does the DIFFERENTIAL half of the vector
 * vocabulary compose into the second derivative test in R²?
 *
 * The same job `green.compose.test.ts` does for the integral half, and the
 * same reason: field.test.ts proves ∇ and H one primitive at a time, and this
 * proves the thing a unit test cannot — that a lesson reaches
 * `Field.gradient` → `Field.hessian` → `LinAlg.eigen` → `M.claim` with no
 * primitive needing a shim to reach the next one.
 *
 * It is also the cheapest available check that the vocabulary GENERALIZES:
 * these are calculus primitives, authored here by a lesson from a different
 * discipline than the one they were built for, and nothing new had to be built
 * to get here except two functions.
 *
 * The pedagogical shape is the one roadmap step 3.5 argues for, and it needs
 * no 3D backend: restrict f to a line through the critical point and let the
 * student rotate the direction. At a MINIMUM the slice curves upward whichever
 * way you turn — a theorem. At a SADDLE it flips, and the direction where it
 * flips is the eigenvector — a conjecture the student breaks by hand.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, World } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import type { BeatPayload } from '@math-ai/lesson';
import { createProgramScope } from './scope.js';
import type { ProgramScope } from './scope.js';

let world: World;
let scope: ProgramScope;

const authored: {
  gradAtCritical?: number;
  bowlEigen?: readonly [number, number];
  saddleEigen?: readonly [number, number];
  bowlSurvivedEveryDirection?: boolean;
  saddleBrokeAtDirection?: number;
  hessianSymmetric?: boolean;
} = {};

/** Every direction the student can turn the slice to, in 5° steps. */
const SWEEP = Array.from({ length: 72 }, (_, i) => (i * Math.PI) / 36);

beforeAll(() => {
  world = createWorld();
  scope = createProgramScope(world, createStage(world));
  const { M, Field, LinAlg, View, Layout, lesson, Interaction } = scope;

  // ── the program, as a lesson would author it ──

  // f has a minimum at the origin; g has a saddle there. Same critical point,
  // opposite verdicts — which is the whole lesson.
  const f = Field.scalarField((x, y) => x * x + 2 * y * y, { label: 'f' });
  const g = Field.scalarField((x, y) => x * x - 2 * y * y, { label: 'g' });

  lesson.beat('A flat spot, twice');
  const fView = View.heatmap(f, { domain: [-2, 2] });
  lesson.show(Layout.columns([fView, View.heatmap(g, { domain: [-2, 2] })]));

  lesson.beat('The gradient dies at the origin — for both');
  const gradF = Field.gradient(f);
  const flat = gradF.magnitudeAt(0, 0);
  // NOT an engine gap, deliberately: nothing here SOLVES for the critical
  // point. The lesson asserts where it is and the claim checks the assertion —
  // the standing division of labour, with the closure as the checker.
  const isCritical = M.claim({
    predicate: () => flat.value < 1e-6,
    label: '\\nabla f(0,0) = 0',
  });
  lesson.show(Layout.stack([View.field(gradF, { domain: [-2, 2] }), View.claim(isCritical)]));
  authored.gradAtCritical = flat.value;

  lesson.beat('Slice it along one direction');
  const theta = M.parameter('\\theta', 0, { range: [0, Math.PI] });
  const dir = (): readonly [number, number] => [Math.cos(theta.value), Math.sin(theta.value)];
  // the 1D restriction — a plain Calc.fn whose rule reads the live direction,
  // so rotating theta redraws the slice for free.
  const sliceF = scope.Calc.fn((t) => {
    const [ux, uy] = dir();
    return f.at(t * ux, t * uy);
  }, { label: 'f\\ \\text{along}\\ u' });
  const sliceG = scope.Calc.fn((t) => {
    const [ux, uy] = dir();
    return g.at(t * ux, t * uy);
  }, { label: 'g\\ \\text{along}\\ u' });
  const sliceFView = View.plot(sliceF, { domain: [-1.5, 1.5] });
  lesson.show(Layout.columns([sliceFView, View.plot(sliceG, { domain: [-1.5, 1.5] })]));
  lesson.expose(theta, { as: 'draggable' });
  lesson.enableInteraction(Interaction.drag(theta, { along: sliceFView }));

  lesson.beat('The Hessian holds every direction at once');
  const Hf = Field.hessian(f, [0, 0]);
  const Hg = Field.hessian(g, [0, 0]);
  authored.hessianSymmetric = Hf.cell(0, 1).id === Hf.cell(1, 0).id;
  const eigF = LinAlg.eigen(Hf);
  const eigG = LinAlg.eigen(Hg);
  lesson.show(
    Layout.stack([
      View.matrix(Hf),
      // eigenvalues as readouts — the papercut step 2.5 fixed. These are
      // NumericHandles, so this line works at all.
      View.readout(eigF.values[0], { label: '\\lambda_1' }),
      View.readout(eigF.values[1], { label: '\\lambda_2' }),
    ]),
  );
  authored.bowlEigen = [eigF.values[0].value, eigF.values[1].value];
  authored.saddleEigen = [eigG.values[0].value, eigG.values[1].value];

  lesson.beat('Try every direction');
  // uᵀHu — the curvature of the slice at the critical point, live in theta.
  const curvature = (H: typeof Hf) =>
    M.derived(() => {
      const [ux, uy] = dir();
      return (
        H.cell(0, 0).value * ux * ux +
        2 * H.cell(0, 1).value * ux * uy +
        H.cell(1, 1).value * uy * uy
      );
    }, 'u^T H u');
  const bowlUp = M.claim({
    predicate: () => curvature(Hf).value > 0,
    label: '\\text{the slice curves upward in every direction}',
  });
  const saddleUp = M.claim({
    predicate: () => curvature(Hg).value > 0,
    label: '\\text{...and for } g \\text{ too?}',
  });
  lesson.show(Layout.columns([View.claim(bowlUp), View.claim(saddleUp)]));

  lesson.beat('In R^n it is the same statement');
  lesson.say`Every eigenvalue positive ⇒ a minimum; mixed signs ⇒ a saddle.`;

  // ── the student's hand: turn the slice all the way around ──
  authored.bowlSurvivedEveryDirection = true;
  for (const angle of SWEEP) {
    theta.setValueLive(angle);
    if (!bowlUp.holds) authored.bowlSurvivedEveryDirection = false;
    if (!saddleUp.holds && authored.saddleBrokeAtDirection === undefined) {
      authored.saddleBrokeAtDirection = angle;
    }
  }
});

describe('the R² second derivative test, authored against the real scope', () => {
  it('runs to completion and lays down its beats in order', () => {
    const beats = world.timeline.root
      .filter((n): n is ActionStep => n.type === 'action' && n.op === 'beat')
      .map((n) => n.payload as BeatPayload);
    expect(beats.map((b) => b.title)).toEqual([
      'A flat spot, twice',
      'The gradient dies at the origin — for both',
      'Slice it along one direction',
      'The Hessian holds every direction at once',
      'Try every direction',
      'In R^n it is the same statement',
    ]);
  });

  it('the gradient identifies the critical point without a solver', () => {
    expect(authored.gradAtCritical!).toBeLessThan(1e-6);
  });

  it('the Hessian is symmetric by construction, so eigen never sees noise', () => {
    expect(authored.hessianSymmetric).toBe(true);
  });

  it('Field.hessian composes straight into LinAlg.eigen', () => {
    // f = x² + 2y² ⇒ H = diag(2, 4); g = x² − 2y² ⇒ H = diag(2, −4)
    const [a, b] = authored.bowlEigen!;
    expect(a).toBeCloseTo(4, 3);
    expect(b).toBeCloseTo(2, 3);
    const [c, d] = authored.saddleEigen!;
    expect(c).toBeCloseTo(2, 3);
    expect(d).toBeCloseTo(-4, 3);
  });

  it('at the minimum the claim is a THEOREM — no direction breaks it', () => {
    expect(authored.bowlSurvivedEveryDirection).toBe(true);
  });

  it('at the saddle it is a CONJECTURE — the student finds the counterexample', () => {
    expect(authored.saddleBrokeAtDirection).toBeDefined();
    // and it breaks exactly where the theory says: for g = x² − 2y² the slice
    // curvature is 2cos²θ − 4sin²θ, which crosses zero at atan(1/√2) ≈ 35.3°.
    // The student's first breaking direction is the first sampled angle past
    // it — so the counterexample is located, not merely detected.
    const angle = authored.saddleBrokeAtDirection!;
    const zeroCrossing = Math.atan(1 / Math.SQRT2);
    expect(angle).toBeGreaterThan(zeroCrossing);
    expect(angle - zeroCrossing).toBeLessThanOrEqual(Math.PI / 36);
  });
});
