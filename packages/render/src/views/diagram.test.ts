/**
 * diagram.test.ts — the geometry escape hatch, model-level and headless, then
 * mounted to a DOM stub.
 *
 * Two things this pins: `draw` is re-run on every paint (a live value read
 * inside it moves the marks with no extra wiring), and the pen speaks only
 * MATH-SPACE — `col`/`bands` return domain values the author feeds back into
 * `pen.*`, never pixels.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { World } from '@math-ai/core';
import type { VarySettable } from '@math-ai/lesson';
import { createStage } from '../stage.js';
import { DiagramView } from './diagram.js';

function setup() {
  const world = createWorld();
  return { world, stage: createStage(world) };
}

/** A minimal live scalar standing in for a Parameter. */
function cell(world: World, initial: number): VarySettable & { setValueLive(next: number): void } {
  const slot = world.slot(initial);
  const base = world.handle('scalar');
  return {
    id: base.id,
    kind: 'scalar',
    get value(): number {
      return slot.value;
    },
    setValue(next: number): void {
      slot.set(next);
    },
    setValueLive(next: number): void {
      slot.poke(next);
    },
  };
}

// ── a DOM stub (this tier has no jsdom; see continuous.test.ts) ──
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

const asFake = (el: Element): FakeEl => el as unknown as FakeEl;

function allWithClass(root: FakeEl, cls: string): FakeEl[] {
  const out: FakeEl[] = [];
  const walk = (el: FakeEl): void => {
    if (el.classes.has(cls)) out.push(el);
    for (const k of el.kids) walk(k);
  };
  walk(root);
  return out;
}

describe('DiagramView — headless op-collection', () => {
  it('provides the frame it declares, so overlays can borrow it', () => {
    const { stage } = setup();
    const view = new DiagramView(stage, {
      frame: { domain: [0, 1], range: [-2, 2] },
      draw: () => {},
    });
    expect(view.ownFrame().domain).toEqual([0, 1]);
    expect(view.ownFrame().range).toEqual([-2, 2]);
    expect(view.elements).toEqual([view]);
  });

  it('collect() runs draw and returns marks in MATH-SPACE', () => {
    const { stage } = setup();
    const view = new DiagramView(stage, {
      frame: { domain: [0, 4], range: [0, 4] },
      draw: (pen) => {
        pen.point(1, 2, { role: 'free' });
        pen.path(
          [
            [0, 0],
            [4, 4],
          ],
          { role: 'escape', closed: true, fill: true },
        );
        pen.text(2, 3, 'q', { anchor: 'start' });
        pen.glyph(3, 1, 'ring', { role: 'reject' });
      },
    });
    const marks = view.collect();
    expect(marks.map((m) => m.type)).toEqual(['point', 'path', 'text', 'glyph']);
    expect(marks[0]).toMatchObject({ type: 'point', role: 'free', at: [1, 2] });
    expect(marks[1]).toMatchObject({ type: 'path', role: 'escape', points: [[0, 0], [4, 4]] });
    expect(marks[2]).toMatchObject({ type: 'text', text: 'q', at: [2, 3] });
    expect(marks[3]).toMatchObject({ type: 'glyph', glyph: 'ring', role: 'reject', at: [3, 1] });
  });

  it('col and bands speak math-space, spanning the domain', () => {
    const { stage } = setup();
    const view = new DiagramView(stage, {
      frame: { domain: [0, 10], range: [0, 1], cols: 5 },
      draw: () => {},
    });
    // reach the pen through a draw that captures it
    let pen!: import('./diagram.js').DiagramPen;
    new DiagramView(stage, { frame: { domain: [0, 10], range: [0, 1], cols: 5 }, draw: (p) => (pen = p) }).collect();
    // 5 columns across [0,10]: centres at 1,3,5,7,9 (band centres, math units)
    expect([0, 1, 2, 3, 4].map((k) => pen.col(k))).toEqual([1, 3, 5, 7, 9]);
    const bands = pen.bands(5);
    expect(bands).toHaveLength(5);
    expect(bands[0]!.center).toBeCloseTo(1, 9);
    expect(bands[4]!.center).toBeCloseTo(9, 9);
    // bands are math-space, always inside the domain
    expect(bands[0]!.lo).toBeGreaterThanOrEqual(0);
    expect(bands[4]!.hi).toBeLessThanOrEqual(10);
    // ticks come from the frame, honest to the domain
    expect(pen.xTicks()).toContain(0);
    expect(view.ownFrame().domain).toEqual([0, 10]);
  });

  it('col without a count and no frame.cols is a clear error', () => {
    const { stage } = setup();
    let pen!: import('./diagram.js').DiagramPen;
    new DiagramView(stage, { frame: { domain: [0, 1], range: [0, 1] }, draw: (p) => (pen = p) }).collect();
    expect(() => pen.col(0)).toThrow(/column count/);
  });

  it('re-runs draw LIVE — a value read inside it moves the marks', () => {
    const { world, stage } = setup();
    const y = cell(world, 0.2);
    const view = new DiagramView(stage, {
      frame: { domain: [0, 1], range: [0, 1] },
      draw: (pen) => pen.point(0.5, y.value),
    });
    expect(view.collect()[0]!.at).toEqual([0.5, 0.2]);
    y.setValueLive(0.8);
    expect(view.collect()[0]!.at).toEqual([0.5, 0.8]);
  });

  it('constructs and applies state headless, before any mount', () => {
    const { world, stage } = setup();
    const y = cell(world, 0.2);
    new DiagramView(stage, { frame: { domain: [0, 1], range: [0, 1] }, draw: (pen) => pen.point(0, y.value) });
    expect(() => stage.applyStateAll()).not.toThrow();
  });
});

describe('DiagramView — mounted paint', () => {
  it('renders marks into the SVG and re-paints them on applyState', () => {
    const { world, stage } = setup();
    const y = cell(world, 0.2);
    const under = world.handle('point');
    const view = new DiagramView(stage, {
      frame: { domain: [0, 1], range: [0, 1] },
      draw: (pen) => pen.point(0.5, y.value, { role: 'free', under }),
    });
    const root = asFake(view.mount(fakeDoc()));

    const before = allWithClass(root, 'mr-mark-point');
    expect(before).toHaveLength(1);
    expect(before[0]!.classes.has('mr-mark')).toBe(true);
    expect(before[0]!.classes.has('mr-role-free')).toBe(true);
    // registered under the semantic handle, so narration / resonance can light it
    expect(stage.registry.nodesFor(under.id)).toHaveLength(1);
    const cyBefore = Number(before[0]!.attrs.get('cy'));

    y.setValueLive(0.9);
    stage.applyStateAll();

    const after = allWithClass(root, 'mr-mark-point');
    expect(after).toHaveLength(1); // layer wiped and rebuilt, still exactly one
    const cyAfter = Number(after[0]!.attrs.get('cy'));
    // higher math-y → lower pixel y
    expect(cyAfter).toBeLessThan(cyBefore);
  });

  it('paints the four mark kinds with their classes', () => {
    const { stage } = setup();
    const view = new DiagramView(stage, {
      frame: { domain: [0, 1], range: [0, 1] },
      draw: (pen) => {
        pen.point(0.1, 0.1);
        pen.path([[0, 0], [1, 1]], { closed: true, fill: true });
        pen.text(0.5, 0.5, 'x');
        pen.glyph(0.9, 0.9, 'arrow', { angle: Math.PI / 2 });
      },
    });
    const root = asFake(view.mount(fakeDoc()));
    expect(allWithClass(root, 'mr-mark-point')).toHaveLength(1);
    expect(allWithClass(root, 'mr-mark-path')).toHaveLength(1);
    expect(allWithClass(root, 'mr-filled')).toHaveLength(1);
    expect(allWithClass(root, 'mr-mark-text')).toHaveLength(1);
    expect(allWithClass(root, 'mr-mark-glyph')).toHaveLength(1);
    // a closed, filled path ends in Z
    const filled = allWithClass(root, 'mr-filled')[0]!;
    expect(filled.attrs.get('d')).toContain('Z');
    // text carries its string and anchor
    const text = allWithClass(root, 'mr-mark-text')[0]!;
    expect(text.textContent).toBe('x');
    expect(text.attrs.get('text-anchor')).toBe('middle');
  });
});

describe('DiagramView — band idiom', () => {
  it('emits a closed, filled strip node with the band class', () => {
    const { stage } = setup();
    const view = new DiagramView(stage, {
      frame: { domain: [0, 1], range: [0, 1] },
      draw: (pen) => pen.band(0.5, { role: 'free' }),
    });
    // the record is a path mark of four corners (a rectangle)
    const marks = view.collect();
    expect(marks).toHaveLength(1);
    expect(marks[0]!.type).toBe('path');
    expect(marks[0]!.points).toHaveLength(4);
    expect(marks[0]!.role).toBe('free');
    // mounted: a filled band node whose path closes (Z)
    const root = asFake(view.mount(fakeDoc()));
    const strips = allWithClass(root, 'mr-band');
    expect(strips).toHaveLength(1);
    expect(strips[0]!.classes.has('mr-filled')).toBe(true);
    expect(strips[0]!.classes.has('mr-role-free')).toBe(true);
    expect(strips[0]!.attrs.get('d')).toContain('Z');
  });

  it('fill:false leaves an outlined strip, no fill class', () => {
    const { stage } = setup();
    const view = new DiagramView(stage, {
      frame: { domain: [0, 1], range: [0, 1] },
      draw: (pen) => pen.band(0.5, { fill: false }),
    });
    const root = asFake(view.mount(fakeDoc()));
    const strips = allWithClass(root, 'mr-band');
    expect(strips).toHaveLength(1);
    expect(strips[0]!.classes.has('mr-filled')).toBe(false);
  });
});

describe('DiagramView — marker idiom', () => {
  const cases: Array<[import('./diagram.js').MarkerState, string]> = [
    ['free', 'mr-role-free'],
    ['constrained', 'mr-role-neutral'],
    ['violated', 'mr-role-reject'],
    ['plain', 'mr-role-neutral'],
  ];
  for (const [state, cls] of cases) {
    it(`maps state '${state}' → ${cls} on the dot`, () => {
      const { stage } = setup();
      const view = new DiagramView(stage, {
        frame: { domain: [0, 1], range: [0, 1] },
        draw: (pen) => pen.marker(0.5, 0.5, { state }),
      });
      const root = asFake(view.mount(fakeDoc()));
      const dots = allWithClass(root, 'mr-dot');
      expect(dots).toHaveLength(1);
      expect(dots[0]!.classes.has(cls)).toBe(true);
    });
  }

  it('draws a dot glyph underneath (kernel stays visible in the record)', () => {
    const { stage } = setup();
    const view = new DiagramView(stage, {
      frame: { domain: [0, 1], range: [0, 1] },
      draw: (pen) => pen.marker(0.3, 0.7, { state: 'violated' }),
    });
    const marks = view.collect();
    expect(marks[0]).toMatchObject({ type: 'glyph', glyph: 'dot', role: 'reject', at: [0.3, 0.7] });
  });
});
