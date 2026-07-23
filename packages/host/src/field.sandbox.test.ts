/**
 * field.sandbox.test.ts — the vector-calculus vocabulary across the sandbox.
 *
 * `Field` is a new guest global, so the host's scope-root list and the guest
 * shim both changed and want a gate. But the reason this file exists is
 * sharper than that: a field's RULE is a guest closure that the host re-invokes
 * per sample — 144 times for one `View.field` paint, four times per lattice
 * edge for a curl. Nothing else in the engine calls back into the guest at that
 * rate (`perf.test.ts` documents the opposite policy for hot numerics), so the
 * shapes that cross here are worth pinning: a closure returning an ARRAY, a
 * traced op over handles minted inside the sandbox, and live values read back
 * after a parameter moves.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';

async function hostWithScope() {
  const world = createWorld();
  const scope = createProgramScope(world, createStage(world));
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  return { world, host };
}

const PROGRAM = [
  'const spin = M.parameter("spin", 1, { range: [-2, 2] });',
  // the rule is a GUEST closure returning a guest array — the host calls it back
  'const F = Field.vectorField((x, y) => [-spin.value * y, spin.value * x], { label: "F" });',
  'const R = Field.rectangle({ x0: -1, y0: -1, x1: 1, y1: 1, label: "\\\\Omega" });',
  'const T = Field.tile(R, { n: 3 });',
  'lesson.beat("Green across the boundary");',
  'lesson.show(View.field(F, { domain: [-2, 2] }));',
  'lesson.show(View.loop(R.boundary));',
  'lesson.show(View.tiling(T, { cellsMode: "deferred" }));',
  'const sweep = Field.walkTiles(F, T);',
  'lesson.demonstrate(sweep);',
  'lesson.focus(T.interiorEdges[0], { emphasize: "disagreement" });',
  'const around = Field.circulation(F, R.boundary);',
  'const green = M.claim({ lhs: around, rhs: sweep.total, relation: "≈", tolerance: 1e-6 });',
  'lesson.show(View.claim(green));',
  'lesson.show(View.heatmap(Field.curl(F), { domain: [-2, 2] }));',
  'globalThis.__probe = {',
  '  cells: sweep.cells.length,',
  '  interior: T.interiorEdges.length,',
  '  boundaryEdges: T.boundaryEdges.length,',
  '  around: around.value,',
  '  swept: sweep.total,',
  '  holds: green.holds,',
  '  curlAtOrigin: F.curlAt(0, 0).value,',
  '  sampleIsArray: Array.isArray(F.at(1, 0)),',
  '};',
].join('\n');

describe('the Field vocabulary through QuickJS', () => {
  it('marshals fields, loops, tilings and a claim built entirely in the guest', async () => {
    const { world, host } = await hostWithScope();
    host.run(PROGRAM);

    expect(world.timeline.root.length).toBeGreaterThan(0);

    const probe = host.evalJSON<Record<string, unknown>>('__probe');
    expect(probe).toMatchObject({
      cells: 9,
      interior: 12,
      boundaryEdges: 12,
      sampleIsArray: true,
      holds: true,
    });
    // curl[-y, x] = 2·spin, and spin is 1
    expect(probe.curlAtOrigin as number).toBeCloseTo(2, 6);
    // ∮ over the unit square = 2·area = 8, and the cells sum to the same
    expect(probe.around as number).toBeCloseTo(8, 6);
    expect(probe.swept as number).toBeCloseTo(8, 6);
    host.dispose();
  });
});
