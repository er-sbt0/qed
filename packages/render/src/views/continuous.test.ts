/**
 * continuous.test.ts — the milestone-6 continuous views, model-level and
 * headless (no DOM): the coordinate frame, what each view projects, and the
 * live quantities they read.
 *
 * The point of these is the two things that are easy to get silently wrong:
 * a region that does not share the plot's mapping (the area drifts off the
 * curve), and a view that snapshots a value it was supposed to read live.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { World } from '@math-ai/core';
import type { NumericHandle, VarySettable } from '@math-ai/lesson';
import { createStage } from '../stage.js';
import { createFrame, rangeOf } from './frame.js';
import { LayoutContainerView } from './layout.js';
import { PlotView } from './plot.js';
import { RegionView } from './region.js';
import { StripView } from './strip.js';
import { RiemannView } from './riemann.js';
import { ReadoutView } from './readout.js';
import { PlaneView } from './plane.js';
import { VectorsView } from './vectors.js';
import { FieldView } from './field.js';
import { HeatmapView } from './heatmap.js';
import { LoopView } from './loop.js';
import { TilingView } from './tiling.js';

function setup() {
  const world = createWorld();
  return { world, stage: createStage(world) };
}

/**
 * A DOM stub, ~30 lines, because the per-element registration the loop and
 * tiling views exist for is only observable after `mount` — and this tier has
 * no jsdom on purpose. It implements exactly what those two `render`s touch.
 */
interface FakeEl {
  readonly tag: string;
  readonly classes: Set<string>;
  readonly attrs: Map<string, string>;
  readonly kids: FakeEl[];
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
      classList: {
        add: (...cs: string[]): void => cs.forEach((c) => classes.add(c)),
        remove: (...cs: string[]): void => cs.forEach((c) => classes.delete(c)),
        contains: (c: string): boolean => classes.has(c),
        toggle: (c: string, on?: boolean): void => {
          if (on ?? !classes.has(c)) classes.add(c);
          else classes.delete(c);
        },
      },
      setAttribute: (n: string, v: string): void => void attrs.set(n, v),
      getAttribute: (n: string): string | null => attrs.get(n) ?? null,
      appendChild: (c: FakeEl): FakeEl => (kids.push(c), c),
      insertBefore: (c: FakeEl): FakeEl => (kids.unshift(c), c),
    };
    return el as unknown as FakeEl;
  };
  return {
    createElement: (tag: string) => make(tag),
    createElementNS: (_ns: string, tag: string) => make(tag),
  } as unknown as Document;
}

const asFake = (el: Element): FakeEl => el as unknown as FakeEl;

/** A minimal live scalar with the interaction hook, standing in for a Parameter. */
function cell(world: World, initial: number): VarySettable & {
  readonly kind: string;
  setValueLive(next: number): void;
} {
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

const F = (x: number): number => 0.5 * x + 1;

describe('coordinate frame', () => {
  it('maps domain to pixels and back', () => {
    const frame = createFrame([0, 6], [0, 4], { width: 320, height: 220, pad: 20 });
    expect(frame.x(0)).toBeCloseTo(20, 6);
    expect(frame.x(6)).toBeCloseTo(300, 6);
    expect(frame.y(0)).toBeCloseTo(200, 6); // y grows downward
    expect(frame.toDomain(frame.x(3.7))).toBeCloseTo(3.7, 6);
  });

  it('a computed range always includes zero and is padded', () => {
    const [lo, hi] = rangeOf([1, 2, 3]);
    expect(lo).toBeLessThanOrEqual(0);
    expect(hi).toBeGreaterThan(3);
  });
});

describe('overlay shares one coordinate frame', () => {
  it('the first frame-providing child lends its frame to the others', () => {
    const { world, stage } = setup();
    const x = cell(world, 2);
    const plot = new PlotView(stage, {
      subject: world.handle('fn'),
      sample: F,
      domain: [0, 6],
    });
    const region = new RegionView(stage, {
      mode: 'under',
      subject: world.handle('fn'),
      sample: F,
      from: 0,
      to: x,
    });
    expect(region.borrowsAmbientFrame).toBe(true);
    new LayoutContainerView(stage, 'overlay', [plot, region]);
    expect(region.borrowsAmbientFrame).toBe(false);
    expect(region.frame).toBe(plot.ownFrame());
  });

  it('a framed view outside an overlay borrows the stage ambient frame', () => {
    const { world, stage } = setup();
    const plot = new PlotView(stage, {
      subject: world.handle('fn'),
      sample: F,
      domain: [0, 6],
    });
    const strip = new StripView(stage, {
      subject: world.handle('increment'),
      at: cell(world, 2),
      width: cell(world, 0.8),
      height: cell(world, F(2)),
      area: cell(world, 1),
      sample: F,
    });
    expect(strip.frame).toBe(plot.ownFrame());
    expect(strip.frame.backdrop()).toContain('M '); // the curve draws behind it
  });
});

describe('PlotView', () => {
  it('samples the rule ONCE at construction, not per read', () => {
    const { world, stage } = setup();
    let calls = 0;
    const plot = new PlotView(stage, {
      subject: world.handle('fn'),
      sample: (x) => {
        calls += 1;
        return F(x);
      },
      domain: [0, 6],
      samples: 51,
    });
    expect(calls).toBe(51);
    const before = calls;
    plot.applyState();
    plot.applyState();
    // applyState moves markers (O(1) reads), it does not re-sample the curve
    expect(calls).toBe(before);
  });

  it('a moving point rides the curve and follows its live quantity', () => {
    const { world, stage } = setup();
    const x = cell(world, 2);
    const plot = new PlotView(stage, { subject: world.handle('fn'), sample: F, domain: [0, 6] });
    plot.pointAt(x);
    expect(plot.markerPositions()[0]).toMatchObject({ x: 2, y: F(2) });
    x.setValueLive(4.5);
    expect(plot.markerPositions()[0]).toMatchObject({ x: 4.5, y: F(4.5) });
  });
});

describe('RegionView', () => {
  it('under a curve: the signed area follows the live upper limit', () => {
    const { world, stage } = setup();
    const to = cell(world, 2);
    const region = new RegionView(stage, {
      mode: 'under',
      subject: world.handle('fn'),
      sample: F,
      from: 0,
      to,
    });
    // ∫₀² (0.5t+1) dt = 3
    expect(region.signedArea()).toBeCloseTo(3, 4);
    to.setValueLive(4);
    // ∫₀⁴ = 4 + 4 = 8
    expect(region.signedArea()).toBeCloseTo(8, 4);
  });

  it('a polygon projects its VERTICES — the granularity a morph routes over', () => {
    const { world, stage } = setup();
    const a = cell(world, 2);
    const verts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ].map((p) => ({ handle: world.handle('vector'), x: () => p.x * a.value, y: () => p.y }));
    const area: NumericHandle = {
      id: world.handle('scalar').id,
      kind: 'scalar',
      get value(): number {
        return a.value; // the parallelogram's signed area for this shear
      },
    };
    const region = new RegionView(stage, {
      mode: 'polygon',
      subject: world.handle('polygon'),
      vertices: verts,
      area,
    });
    expect(region.elements).toHaveLength(4);
    expect(region.signedArea()).toBeCloseTo(2, 6);
    a.setValueLive(-1); // orientation reversed: the view reads the sign live
    expect(region.signedArea()).toBeLessThan(0);
  });
});

describe('StripView', () => {
  it('reads width and height live, so the limit animation narrows it', () => {
    const { world, stage } = setup();
    const dx = cell(world, 0.8);
    const strip = new StripView(stage, {
      subject: world.handle('increment'),
      at: cell(world, 2),
      width: dx,
      height: cell(world, F(2)),
      area: cell(world, 1.6),
      sample: F,
    });
    expect(strip.geometry().width).toBeCloseTo(0.8, 9);
    dx.setValueLive(0.005);
    expect(strip.geometry().width).toBeCloseTo(0.005, 9);
  });
});

describe('RiemannView', () => {
  it('each slice is addressable, and they sum to the decomposition', () => {
    const { world, stage } = setup();
    const rects = [0, 1, 2, 3].map((i) => ({
      handle: world.handle('rectangle'),
      x0: i * 0.5,
      x1: (i + 1) * 0.5,
      height: F(i * 0.5 + 0.25),
    }));
    const view = new RiemannView(stage, {
      subject: world.handle('riemann'),
      rectangles: rects,
      sample: F,
    });
    expect(view.elements).toHaveLength(4);
    // midpoint rule is exact for a linear f: ∫₀² = 3
    expect(view.total()).toBeCloseTo(3, 9);
  });
});

describe('ReadoutView', () => {
  it('reports the gap between two live quantities as it closes', () => {
    const { world, stage } = setup();
    const rate = cell(world, 2.4);
    const height = cell(world, 2.0);
    const view = new ReadoutView(stage, { quantity: rate, compareTo: height });
    expect(view.values().gap).toBeCloseTo(0.4, 9);
    rate.setValueLive(2.001);
    expect(Math.abs(view.values().gap!)).toBeLessThan(0.01);
    expect(view.elements).toHaveLength(2);
  });
});

describe('PlaneView and VectorsView', () => {
  it('the plane provides a frame; vectors drawn on it read components live', () => {
    const { world, stage } = setup();
    const plane = new PlaneView(stage, { grid: true, domain: [-3, 3] });
    const a = cell(world, 1);
    const vectors = new VectorsView(stage, {
      vectors: [{ handle: world.handle('vector'), x: () => a.value, y: () => 0 }],
    });
    new LayoutContainerView(stage, 'overlay', [plane, vectors]);
    expect(vectors.frame).toBe(plane.ownFrame());
    expect(plane.ownFrame().domain).toEqual([-3, 3]);
    expect(vectors.elements).toHaveLength(1);
  });
});

describe('FieldView', () => {
  it('provides a square frame over the spec domain', () => {
    const { stage } = setup();
    const field = new FieldView(stage, {
      rule: (x, y) => [y, -x],
      domain: [-2, 2],
    });
    const f = field.ownFrame();
    expect(f.domain).toEqual([-2, 2]);
    expect(f.range).toEqual([-2, 2]); // range defaults to domain: a square patch
    expect(f.width).toBe(f.height);
  });

  it('lays grid² samples on a lattice spanning the domain edge to edge', () => {
    const { stage } = setup();
    const field = new FieldView(stage, { rule: (x, y) => [y, -x], domain: [-2, 2], grid: 5 });
    const s = field.samples();
    expect(s).toHaveLength(25);
    expect(s[0]).toMatchObject({ x: -2, y: -2 });
    expect(s[24]).toMatchObject({ x: 2, y: 2 });
    const xs = new Set(s.map((p) => p.x));
    expect(xs.size).toBe(5);
    // the rule is what it says it is, at every point
    for (const p of s) {
      expect(p.u).toBeCloseTo(p.y, 9);
      expect(p.v).toBeCloseTo(-p.x, 9);
    }
  });

  it('re-samples the rule LIVE — a Parameter inside it redraws the field', () => {
    const { world, stage } = setup();
    const k = cell(world, 1);
    const field = new FieldView(stage, {
      rule: (x, y) => [k.value * y, -x],
      domain: [-2, 2],
      grid: 4,
    });
    const before = field.samples().map((p) => p.u);
    k.setValueLive(-3);
    const after = field.samples().map((p) => p.u);
    expect(after).not.toEqual(before);
    const s = field.samples();
    for (const p of s) expect(p.u).toBeCloseTo(-3 * p.y, 9);
  });

  it('constructs and applies state headless, before any mount', () => {
    const { stage } = setup();
    new FieldView(stage, { rule: (x, y) => [y, -x], domain: [-1, 1] });
    expect(() => stage.applyStateAll()).not.toThrow();
  });

  it('projects its SUBJECT — a shown field must be reachable by id (4c)', () => {
    const { world, stage } = setup();
    const subject = world.handle('vectorField');
    const view = new FieldView(stage, { rule: (x, y) => [y, -x], domain: [-1, 1], subject });
    expect(view.elements).toEqual([subject]);
    expect(view.projects(subject.id)).toBe(true);
    // without a subject the view stays its own single element
    const bare = new FieldView(stage, { rule: (x, y) => [y, -x], domain: [-1, 1] });
    expect(bare.elements).toEqual([bare]);
  });
});

describe('HeatmapView', () => {
  it('tiles the domain with grid² cells and no gaps or overlaps', () => {
    const { stage } = setup();
    const map = new HeatmapView(stage, { rule: (x, y) => x + y, domain: [0, 4], grid: 4 });
    const cells = map.cells();
    expect(cells).toHaveLength(16);
    expect(cells[0]!.x0).toBe(0);
    expect(cells[15]!.x1).toBe(4);
    expect(cells[15]!.y1).toBe(4);
    // row-major, x fastest: each cell's right edge is EXACTLY its neighbour's left
    for (let i = 0; i < 3; i += 1) {
      expect(cells[i]!.x1).toBe(cells[i + 1]!.x0);
      expect(cells[i]!.y0).toBe(cells[i + 1]!.y0);
    }
    // and each row's top edge is exactly the next row's bottom
    expect(cells[0]!.y1).toBe(cells[4]!.y0);
    // cells sample their own centre
    expect(cells[0]!.value).toBeCloseTo(1, 9);
  });

  it('re-evaluates the rule LIVE — a weakening field fades', () => {
    const { world, stage } = setup();
    const k = cell(world, 2);
    const map = new HeatmapView(stage, {
      rule: (x, y) => k.value * (x * x - y * y),
      domain: [-1, 1],
      grid: 4,
    });
    const before = map.cells().map((c) => c.value);
    k.setValueLive(0.25);
    const after = map.cells().map((c) => c.value);
    expect(after).not.toEqual(before);
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i]!).toBeCloseTo(before[i]! / 8, 9);
    }
  });

  it('provides a square frame and applies state headless, before any mount', () => {
    const { stage } = setup();
    const map = new HeatmapView(stage, { rule: (x, y) => x * y, domain: [-3, 3] });
    expect(map.ownFrame().domain).toEqual([-3, 3]);
    expect(map.ownFrame().width).toBe(map.ownFrame().height);
    expect(map.cells()).toHaveLength(256); // the default grid of 16
    expect(map.elements).toEqual([map]);
    expect(() => stage.applyStateAll()).not.toThrow();
  });
});

describe('LoopView', () => {
  /** A unit square whose right edge rides a live scalar. */
  function square(world: World, a: { readonly value: number }) {
    const pts: readonly (() => readonly [number, number])[] = [
      () => [0, 0],
      () => [a.value, 0],
      () => [a.value, 1],
      () => [0, 1],
    ];
    return pts.map((p, i) => ({
      handle: world.handle('segment'),
      from: p,
      to: pts[(i + 1) % pts.length]!,
    }));
  }

  it('walks the live vertex chain — a dragged corner moves the loop', () => {
    const { world, stage } = setup();
    const a = cell(world, 1);
    const view = new LoopView(stage, {
      subject: world.handle('loop'),
      segments: square(world, a),
      domain: [-2, 2],
    });
    expect(view.path()).toHaveLength(4);
    expect(view.path()[1]).toEqual([1, 0]);
    a.setValueLive(3);
    expect(view.path()[1]).toEqual([3, 0]); // LIVE: no re-construction
    expect(view.path()[2]).toEqual([3, 1]);
  });

  it('projects every SEGMENT, so focus can light one edge', () => {
    const { world, stage } = setup();
    const segs = square(world, cell(world, 1));
    const view = new LoopView(stage, {
      subject: world.handle('loop'),
      segments: segs,
      domain: [-2, 2],
    });
    expect(view.elements.map((e) => e.id)).toEqual(segs.map((s) => s.handle.id));
    const doc = fakeDoc();
    view.mount(doc);
    for (const s of segs) {
      const nodes = stage.registry.nodesFor(s.handle.id);
      expect(nodes).toHaveLength(1);
      expect(asFake(nodes[0]!).classes.has('mr-loop-edge')).toBe(true);
      expect(asFake(nodes[0]!).attrs.get('d')).toContain('M ');
    }
  });

  it('with a domain it PROVIDES a square frame; without one it borrows', () => {
    const { world, stage } = setup();
    const provider = new LoopView(stage, {
      subject: world.handle('loop'),
      segments: square(world, cell(world, 1)),
      domain: [-2, 2],
    });
    expect(provider.ownFrame()?.domain).toEqual([-2, 2]);
    expect(provider.ownFrame()?.range).toEqual([-2, 2]);
    expect(provider.borrowsAmbientFrame).toBe(false);

    // a loop drawn over a field: it must land in the FIELD's mapping
    const subject = world.handle('loop');
    const field = new FieldView(stage, { rule: (x, y) => [y, -x], domain: [-5, 5], subject });
    // a later provider makes itself ambient — the loop must NOT drift onto it
    new HeatmapView(stage, { rule: () => 1, domain: [0, 1] });
    const borrower = new LoopView(stage, { subject, segments: square(world, cell(world, 1)) });
    expect(borrower.ownFrame()).toBe(null);
    expect(borrower.frame).toBe(field.ownFrame());
  });

  it('draws orientation barbs by default and omits them on request', () => {
    const { world, stage } = setup();
    const segs = square(world, cell(world, 1));
    const bare = new LoopView(stage, {
      subject: world.handle('loop'),
      segments: segs,
      domain: [-2, 2],
      showOrientation: false,
    });
    bare.mount(fakeDoc());
    const plain = asFake(stage.registry.nodesFor(segs[0]!.handle.id)[0]!).attrs.get('d')!;
    expect(plain.match(/M /g)).toHaveLength(1); // shaft only

    const { world: w2, stage: s2 } = setup();
    const segs2 = square(w2, cell(w2, 1));
    const arrow = new LoopView(s2, {
      subject: w2.handle('loop'),
      segments: segs2,
      domain: [-2, 2],
    });
    arrow.mount(fakeDoc());
    const withBarb = asFake(s2.registry.nodesFor(segs2[0]!.handle.id)[0]!).attrs.get('d')!;
    expect(withBarb.match(/M /g)).toHaveLength(2); // shaft + inline barb
  });

  it('constructs and applies state headless, before any mount', () => {
    const { world, stage } = setup();
    new LoopView(stage, {
      subject: world.handle('loop'),
      segments: square(world, cell(world, 1)),
      domain: [-2, 2],
    });
    expect(() => stage.applyStateAll()).not.toThrow();
  });
});

describe('TilingView', () => {
  /**
   * Two cells side by side sharing ONE segment handle — the library's
   * by-construction sharing, reduced to the smallest case that shows it.
   */
  function pair(world: World) {
    const shared = world.handle('segment');
    const cells = [
      {
        handle: world.handle('tile'),
        corners: () =>
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ] as readonly (readonly [number, number])[],
      },
      {
        handle: world.handle('tile'),
        corners: () =>
          [
            [1, 0],
            [2, 0],
            [2, 1],
            [1, 1],
          ] as readonly (readonly [number, number])[],
      },
    ];
    const edges = [
      // the left cell holds the shared edge forward…
      {
        handle: shared,
        from: () => [1, 0] as readonly [number, number],
        to: () => [1, 1] as readonly [number, number],
        interior: true,
      },
      // …and the right cell holds the SAME id, reversed
      {
        handle: shared,
        from: () => [1, 1] as readonly [number, number],
        to: () => [1, 0] as readonly [number, number],
        interior: true,
      },
      {
        handle: world.handle('segment'),
        from: () => [0, 0] as readonly [number, number],
        to: () => [2, 0] as readonly [number, number],
        interior: false,
      },
    ];
    return { shared, cells, edges };
  }

  it('counts its cells and separates interior edges from boundary ones', () => {
    const { world, stage } = setup();
    const { cells, edges } = pair(world);
    const view = new TilingView(stage, {
      subject: world.handle('tiling'),
      cells,
      edges,
      domain: [0, 2],
    });
    expect(view.cellCount()).toBe(2);
    expect(view.edgeCount()).toEqual({ interior: 2, boundary: 1 });
    expect(view.elements).toHaveLength(5); // every cell and every edge is addressable
  });

  it('two cells share ONE segment id, and focusing it resolves to BOTH nodes', () => {
    const { world, stage } = setup();
    const { shared, cells, edges } = pair(world);
    const view = new TilingView(stage, {
      subject: world.handle('tiling'),
      cells,
      edges,
      domain: [0, 2],
    });
    view.mount(fakeDoc());
    // the registry is a multi-map: the cancellation beat lights the pair
    const nodes = stage.registry.nodesFor(shared.id);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).not.toBe(nodes[1]);
    for (const n of nodes) {
      expect(asFake(n).classes.has('mr-tiling-edge')).toBe(true);
      expect(asFake(n).classes.has('mr-interior')).toBe(true);
    }
    const outer = stage.registry.nodesFor(edges[2]!.handle.id);
    expect(asFake(outer[0]!).classes.has('mr-boundary')).toBe(true);
  });

  it('deferred cells start pre-hidden so demonstrate inks them in', () => {
    const { world, stage } = setup();
    const { cells, edges } = pair(world);
    const view = new TilingView(stage, {
      subject: world.handle('tiling'),
      cells,
      edges,
      domain: [0, 2],
    });
    view.mount(fakeDoc());
    for (const c of cells) {
      const node = asFake(stage.registry.nodesFor(c.handle.id)[0]!);
      expect(node.classes.has('mr-prehidden')).toBe(true);
      expect(node.attrs.get('d')).toContain('Z'); // a closed polygon
    }

    const { world: w2, stage: s2 } = setup();
    const p2 = pair(w2);
    new TilingView(s2, {
      subject: w2.handle('tiling'),
      cells: p2.cells,
      edges: p2.edges,
      domain: [0, 2],
      cellsMode: 'shown',
    }).mount(fakeDoc());
    const shownNode = asFake(s2.registry.nodesFor(p2.cells[0]!.handle.id)[0]!);
    expect(shownNode.classes.has('mr-prehidden')).toBe(false);
  });

  it('borrows the frame of the field it is laid over, and applies state headless', () => {
    const { world, stage } = setup();
    const subject = world.handle('tiling');
    const field = new FieldView(stage, { rule: (x, y) => [y, -x], domain: [-4, 4], subject });
    const { cells, edges } = pair(world);
    const view = new TilingView(stage, { subject, cells, edges });
    expect(view.ownFrame()).toBe(null);
    expect(view.frame).toBe(field.ownFrame());
    expect(() => stage.applyStateAll()).not.toThrow();
  });
});
