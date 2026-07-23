/**
 * formula.test.ts — the F.tex contract: raw strings survive, one role covers
 * many fragments, spans are addressable handles, unknown roles diagnose.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createF } from './formula.js';

function setup() {
  const world = createWorld();
  return { world, F: createF(world) };
}

describe('F.tex', () => {
  it('reads strings.raw — TeX backslashes survive the tag', () => {
    const { F } = setup();
    const f = F.tex`x \sim_L y \iff \forall z`;
    expect(f.tex).toBe('x \\sim_L y \\iff \\forall z');
  });

  it('one role covers every fragment it recurs in, under a single span handle', () => {
    const { F } = setup();
    const f = F.tex`${F.span('pi', '\\pi')} P = ${F.span('pi', '\\pi')}`;
    const roleFragments = f.fragments.filter((fr) => fr.role === 'pi');
    expect(roleFragments).toHaveLength(2);
    expect(roleFragments.map((fr) => fr.tex)).toEqual(['\\pi', '\\pi']);
    expect(f.roles).toEqual(['pi']);
    // addressing the role addresses all fragments at once: one handle
    expect(f.span('pi')).toBe(f.span('pi'));
    expect(f.span('pi').kind).toBe('span');
  });

  it('interleaves plain segments, string interpolations, and role spans in order', () => {
    const { F } = setup();
    const n = 3;
    const f = F.tex`p_{${String(n)}}(${F.span('dest', 'j')}) = ${F.span('merge', '\\sum_i')} q_i`;
    expect(f.fragments.map((fr) => fr.tex)).toEqual(['p_{', '3', '}(', 'j', ') = ', '\\sum_i', ' q_i']);
    expect(f.fragments.map((fr) => fr.role)).toEqual([
      undefined,
      undefined,
      undefined,
      'dest',
      undefined,
      'merge',
      undefined,
    ]);
    expect(f.roles).toEqual(['dest', 'merge']);
  });

  it('span handles are world-minted and distinct per role and per formula', () => {
    const { F } = setup();
    const f1 = F.tex`${F.span('a', 'x')} + ${F.span('b', 'y')}`;
    const f2 = F.tex`${F.span('a', 'z')}`;
    expect(f1.span('a').id).not.toBe(f1.span('b').id);
    expect(f1.span('a').id).not.toBe(f2.span('a').id);
    expect(f1.id).not.toBe(f2.id);
    expect(f1.kind).toBe('formula');
  });

  it('unknown roles throw a diagnostic listing the available roles', () => {
    const { F } = setup();
    const f = F.tex`${F.span('suffix', 'z')} \in \Sigma^{*}`;
    expect(() => f.span('prefix')).toThrow(/no span role "prefix".*suffix/s);
    const empty = F.tex`a + b`;
    expect(() => empty.span('x')).toThrow(/\(none\)/);
  });

  it('span handles participate in the correspondence graph like any handle', () => {
    const { world, F } = setup();
    const f = F.tex`${F.span('suffix', 'z')}`;
    const w1 = world.handle('word');
    const w2 = world.handle('word');
    world.link(f.span('suffix'), [w1, w2], 'represents');
    expect(world.graph.reachable(f.span('suffix'), w1)).toBe(true);
    expect(world.graph.reachable(f.span('suffix'), w2)).toBe(true);
  });
});
