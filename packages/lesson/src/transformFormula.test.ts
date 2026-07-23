/**
 * transformFormula.test.ts — the deferred formula-morphing seam (Δ3.2). A
 * span-preserving formula→formula transition: shared roles keep identity
 * (bridged by a counterpart-of edge so links survive), from-only roles leave,
 * to-only roles enter; sharing no role is illegal.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, World } from '@math-ai/core';
import { createF } from './formula.js';
import { createLesson } from './lesson.js';
import type { FormulaBuilder } from './formula.js';
import type { Lesson } from './lesson.js';
import type { TransformFormulaPayload } from './types.js';

function setup(): { world: World; F: FormulaBuilder; lesson: Lesson } {
  const world = createWorld();
  return { world, F: createF(world), lesson: createLesson(world) };
}

// The FTC ÷Δx turn: ΔA ≈ f(x)Δx  →  ΔA/Δx ≈ f(x)
function ftcPair(F: FormulaBuilder) {
  const approx = F.tex`${F.span('dA', '\\Delta A')} \approx ${F.span('fx', 'f(x)')}${F.span('dx', '\\Delta x')}`;
  const rate = F.tex`\frac{${F.span('dA', '\\Delta A')}}{${F.span('dx', '\\Delta x')}} \approx ${F.span('fx', 'f(x)')}`;
  return { approx, rate };
}

describe('lesson.transformFormula', () => {
  it('preserves span identity for every shared role', () => {
    const { F, lesson } = setup();
    const { approx, rate } = ftcPair(F);
    const step = lesson.transformFormula(approx, rate) as ActionStep;
    expect(step.op).toBe('transformFormula');
    const payload = stepPayload<TransformFormulaPayload>(step);
    expect(payload.preserved.map((p) => p.role).sort()).toEqual(['dA', 'dx', 'fx']);
    // each pair links the from-span handle to the to-span handle (distinct ids)
    for (const pair of payload.preserved) {
      expect(pair.from.id).not.toBe(pair.to.id);
      expect(pair.from.id).toBe(approx.span(pair.role).id);
      expect(pair.to.id).toBe(rate.span(pair.role).id);
    }
  });

  it('records a counterpart-of bridge so a link on one span reaches the other', () => {
    const { world, F, lesson } = setup();
    const { approx, rate } = ftcPair(F);
    lesson.transformFormula(approx, rate);
    // the moved f(x) span keeps its identity across the morph
    expect(world.graph.reachable(approx.span('fx'), rate.span('fx'))).toBe(true);
    expect(world.graph.reachable(approx.span('dx'), rate.span('dx'))).toBe(true);

    // a correspondence link authored on the FROM span survives onto the TO span
    const strip = world.handle('increment');
    world.link(approx.span('fx'), strip, 'represents');
    expect(world.graph.reachable(rate.span('fx'), strip)).toBe(true);
  });

  it('classifies entering (to-only) and leaving (from-only) roles', () => {
    const { F, lesson } = setup();
    const from = F.tex`${F.span('shared', 'a')} + ${F.span('gone', 'b')}`;
    const to = F.tex`${F.span('shared', 'a')} - ${F.span('fresh', 'c')}`;
    const step = lesson.transformFormula(from, to);
    const payload = stepPayload<TransformFormulaPayload>(step);
    expect(payload.preserved.map((p) => p.role)).toEqual(['shared']);
    expect(payload.leaving).toHaveLength(1); // "gone"
    expect(payload.entering).toHaveLength(1); // "fresh"
    expect(payload.leaving[0]!.id).toBe(from.span('gone').id);
    expect(payload.entering[0]!.id).toBe(to.span('fresh').id);
  });

  it('is illegal when the two formulas share no role', () => {
    const { F, lesson } = setup();
    const from = F.tex`${F.span('a', 'x')}`;
    const to = F.tex`${F.span('b', 'y')}`;
    expect(() => lesson.transformFormula(from, to)).toThrow(/share no span role/);
  });
});

function stepPayload<T>(step: { id: string }): T {
  // steps are timeline ActionStep handles; read the payload the runtime stored
  return (step as unknown as { payload: T }).payload;
}
