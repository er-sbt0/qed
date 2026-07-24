/**
 * diagram.sandbox.test.ts — the SPIKE for roadmap step (b): the geometry
 * escape hatch through qed's REAL pipeline.
 *
 * `View.diagram(frame, draw)` hands the program a `pen` and re-runs `draw` on
 * every paint. When `draw` is a guest closure, this exercises the one cell the
 * probe left unproven: a re-entrant proxy-method INVOKE with a host side effect
 * across the QuickJS boundary. The host re-invokes the retained `draw` closure
 * at paint; it reads `spin.value` (a guest→host GET) and calls `pen.point(...)`
 * (a guest→host INVOKE) whose effect is a mark node in the SVG. If that whole
 * loop works — and moves the mark when the parameter moves — the escape hatch
 * is real inside qed, not just in a browser.
 *
 * Two predictions are checked in passing: the program survives the static lint
 * (a `draw` closure is textually like a field rule), and the pen crosses BY
 * REFERENCE (Handle-shaped) rather than being value-copied to dead stubs — the
 * latter is what a moving mark proves.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage, sceneIndex } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';
import { lint } from './lint.js';

/**
 * A minimal DOM stub — this tier has no jsdom (see continuous.test.ts). It
 * implements exactly what a DiagramView's `render` + pen touch: element
 * creation, class/attr writes, child append, and `replaceChildren` (the pen
 * wipes the marks layer each paint).
 */
interface FakeEl {
  readonly tag: string;
  readonly classes: Set<string>;
  readonly attrs: Map<string, string>;
  readonly kids: FakeEl[];
  textContent: string;
}

function fakeDoc(): Document {
  const make = (tag: string): FakeEl => {
    const classes = new Set<string>();
    const attrs = new Map<string, string>();
    const kids: FakeEl[] = [];
    const el = {
      tag,
      classes,
      attrs,
      kids,
      textContent: '',
      classList: {
        add: (...cs: string[]): void => cs.forEach((c) => classes.add(c)),
        remove: (...cs: string[]): void => cs.forEach((c) => classes.delete(c)),
        contains: (c: string): boolean => classes.has(c),
      },
      setAttribute: (n: string, v: string): void => void attrs.set(n, v),
      getAttribute: (n: string): string | null => attrs.get(n) ?? null,
      appendChild: (c: FakeEl): FakeEl => (kids.push(c), c),
      insertBefore: (c: FakeEl): FakeEl => (kids.unshift(c), c),
      replaceChildren: (...cs: FakeEl[]): void => {
        kids.length = 0;
        kids.push(...cs);
      },
    };
    return el as unknown as FakeEl;
  };
  return {
    createElement: (tag: string) => make(tag),
    createElementNS: (_ns: string, tag: string) => make(tag),
  } as unknown as Document;
}

/** Every element in the subtree whose class set contains `cls`. */
function allWithClass(root: FakeEl, cls: string): FakeEl[] {
  const out: FakeEl[] = [];
  const walk = (el: FakeEl): void => {
    if (el.classes.has(cls)) out.push(el);
    for (const k of el.kids) walk(k);
  };
  walk(root);
  return out;
}

interface LiveParam {
  readonly label?: string;
  setValueLive(next: number): void;
}

const PROGRAM = [
  'const spin = M.parameter("spin", 0.3, { range: [0, 1] });',
  'lesson.beat("The escape hatch");',
  'lesson.show(View.diagram({ domain: [0, 1], range: [0, 1] }, (pen) => {',
  '  pen.point(0.5, spin.value, { role: "free" });',
  '}));',
  // a readout puts `spin` in the scene index, so the test can drive it as a drag would
  'lesson.show(View.readout(spin, { label: "spin" }));',
].join('\n');

async function hostWithScope() {
  const world = createWorld();
  const stage = createStage(world);
  const scope = createProgramScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  return { world, stage, host };
}

describe('the geometry escape hatch through QuickJS', () => {
  it('a guest draw closure emits a live mark that moves when its parameter moves', async () => {
    // ── prediction 1: the program survives the static gate as authored ──
    expect(lint(PROGRAM).ok).toBe(true);

    const { stage, host } = await hostWithScope();
    host.run(PROGRAM);

    // the diagram view is on the stage after the authoring pass
    const view = stage.views.find((v) => v.kind === 'view:diagram');
    expect(view, 'View.diagram must construct a view on the stage').toBeTruthy();

    // ── (a) a mark node appears in the SVG after the first paint ──
    const root = view!.mount(fakeDoc()) as unknown as FakeEl;
    const marksBefore = allWithClass(root, 'mr-mark-point');
    expect(marksBefore).toHaveLength(1);
    // the role carried through the guest→host invoke onto the DOM class
    expect(marksBefore[0]!.classes.has('mr-role-free')).toBe(true);
    const cy0 = Number(marksBefore[0]!.attrs.get('cy'));
    expect(Number.isFinite(cy0)).toBe(true);

    // ── (b) moving the parameter moves the mark ──
    const spin = sceneIndex(stage).get(
      [...sceneIndex(stage).values()].find(
        (h) => (h as { label?: unknown }).label === 'spin' && h.kind === 'parameter',
      )!.id,
    ) as unknown as LiveParam;
    spin.setValueLive(0.9);
    stage.applyStateAll();

    const marksAfter = allWithClass(root, 'mr-mark-point');
    expect(marksAfter).toHaveLength(1); // wiped and rebuilt, still exactly one
    const cy1 = Number(marksAfter[0]!.attrs.get('cy'));
    // spin 0.3 → 0.9 raises the math-y, which LOWERS pixel y (SVG y grows down)
    expect(cy1).toBeLessThan(cy0);

    host.dispose();
  });
});
