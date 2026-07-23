import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createFieldLib } from './field.js';
import { createParameter } from './parameter.js';

const near = (a: number, b: number, tol = 1e-3): void => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('Field', () => {
  it('samples an authored closure', () => {
    const Field = createFieldLib(createWorld());
    const F = Field.vectorField((x, y) => [-y, x], { label: 'F' });
    expect(F.at(2, 3)).toEqual([-3, 2]);
    expect(F.label).toBe('F');
  });

  it('computes the scalar curl — rigid rotation swirls, a gradient does not', () => {
    const Field = createFieldLib(createWorld());
    // [-y, x] is rotation: curl = 1 - (-1) = 2, uniformly.
    const rot = Field.vectorField((x, y) => [-y, x]);
    near(Field.curl(rot).at(0, 0), 2);
    near(Field.curl(rot).at(1.7, -0.4), 2);

    // a gradient field is curl-free everywhere — the fact Green's theorem
    // leans on, so it is worth pinning.
    const grad = Field.vectorField((x, y) => [2 * x * y, x * x]);
    near(Field.curl(grad).at(1, 1), 0);
    near(Field.curl(grad).at(-2, 0.5), 0);
  });

  it('computes divergence', () => {
    const Field = createFieldLib(createWorld());
    const out = Field.vectorField((x, y) => [x, y]); // div = 2
    near(Field.divergence(out).at(3, -1), 2);
    const rot = Field.vectorField((x, y) => [-y, x]); // div = 0
    near(Field.divergence(rot).at(3, -1), 0);
  });

  it('curl of a non-uniform field varies with position', () => {
    const Field = createFieldLib(createWorld());
    // [0, x^2] has curl 2x
    const F = Field.vectorField((x, y) => [0, x * x]);
    const c = Field.curl(F);
    near(c.at(0, 0), 0);
    near(c.at(1, 0), 2);
    near(c.at(-1.5, 9), -3);
  });

  it('a Parameter inside the rule makes the whole field live', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const spin = createParameter(world, 'spin', 1, [-2, 2]);
    const F = Field.vectorField((x, y) => [-spin.value * y, spin.value * x]);

    // the snapshot follows...
    expect(F.at(1, 1)).toEqual([-1, 1]);
    spin.setValueLive(2);
    expect(F.at(1, 1)).toEqual([-2, 2]);

    // ...and so does a live derived read of the curl (2·spin)
    const c = F.curlAt(0, 0);
    near(c.value, 4);
    spin.setValueLive(-1);
    near(c.value, -2);
  });

  it('curlAt / valueAt track a moving point, not just a moving rule', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const x = createParameter(world, 'x', 0, [-3, 3]);
    const F = Field.vectorField((px) => [0, px * px]); // curl = 2x
    const c = F.curlAt(x, 0);

    near(c.value, 0);
    x.setValueLive(1.5);
    near(c.value, 3);

    const g = Field.scalarField((px, py) => px + py, { label: 'g' });
    const gv = g.valueAt(x, 2);
    near(gv.value, 3.5);
    x.setValueLive(-2);
    near(gv.value, 0);
  });

  it('magnitudeAt is live', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const r = createParameter(world, 'r', 3, [0, 5]);
    const F = Field.vectorField(() => [r.value, 4]);
    const m = F.magnitudeAt(0, 0);
    near(m.value, 5);
    r.setValueLive(0);
    near(m.value, 4);
  });
});

describe('loops and circulation', () => {
  it('a rectangle loop encloses a positive signed area, its reverse a negative one', () => {
    const Field = createFieldLib(createWorld());
    const C = Field.rectangleLoop({ x0: 0, y0: 0, x1: 2, y1: 3 });
    expect(C.segments).toHaveLength(4);
    near(C.area.value, 6);
    near(C.reversed().area.value, -6);
  });

  it('reversing a loop reuses the SAME segment identities', () => {
    const Field = createFieldLib(createWorld());
    const C = Field.rectangleLoop({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const back = C.reversed();
    expect(new Set(back.segments.map((s) => s.id))).toEqual(new Set(C.segments.map((s) => s.id)));
    expect(back.segments.map((s) => s.orientation)).toEqual([-1, -1, -1, -1]);
    // and the flip is an involution, not a fresh copy each time
    expect(C.segments[0]!.reversed().reversed()).toBe(C.segments[0]);
  });

  it('a reversed segment reverses its contribution — the cancellation mechanism', () => {
    const Field = createFieldLib(createWorld());
    const F = Field.vectorField((x, y) => [-y, x]);
    const C = Field.rectangleLoop({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const seg = C.segments[0]!;
    const forward = Field.contribution(F, seg);
    const backward = Field.contribution(F, seg.reversed());
    near(forward.value + backward.value, 0);
  });

  it('circulation of a rotation field is 2·area — Green, checked directly', () => {
    const Field = createFieldLib(createWorld());
    // curl[-y, x] = 2, so ∮ = ∬2 dA = 2·area for ANY region
    const F = Field.vectorField((x, y) => [-y, x]);
    near(Field.circulation(F, Field.rectangleLoop({ x0: 0, y0: 0, x1: 2, y1: 3 })).value, 12);
    near(Field.circulation(F, Field.rectangleLoop({ x0: -1, y0: -1, x1: 1, y1: 1 })).value, 8);
    // a gradient field is conservative: zero around every closed loop
    const grad = Field.vectorField((x, y) => [2 * x * y, x * x]);
    near(Field.circulation(grad, Field.rectangleLoop({ x0: 0, y0: 0, x1: 2, y1: 3 })).value, 0);
  });

  it('circulation is REACTIVE — it follows a parameter in the field rule', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const spin = createParameter(world, 'spin', 1, [-2, 2]);
    const F = Field.vectorField((x, y) => [-spin.value * y, spin.value * x]);
    const C = Field.rectangleLoop({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const circ = Field.circulation(F, C);

    near(circ.value, 2);
    spin.setValueLive(-1);
    near(circ.value, -2);
  });

  it('circulation is REACTIVE in the loop too — a dragged corner moves it', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const w = createParameter(world, 'w', 1, [0, 4]);
    const F = Field.vectorField((x, y) => [-y, x]);
    const C = Field.rectangleLoop({ x0: 0, y0: 0, x1: w, y1: 1 });
    const circ = Field.circulation(F, C);

    near(circ.value, 2);
    w.setValueLive(3);
    near(circ.value, 6);
  });

  it('a region hands out its boundary by construction, and links it', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const R = Field.rectangle({ x0: 0, y0: 0, x1: 2, y1: 2, label: 'R' });
    near(R.area.value, 4);
    near(R.boundary.area.value, 4);
    expect(
      world.graph.edgesOf(R.boundary).some((e) => e.rel === 'counterpart-of' && e.b.id === R.id),
    ).toBe(true);
  });

  it('the traced walk emits one contribution per segment and totals the circulation', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const F = Field.vectorField((x, y) => [-y, x]);
    const C = Field.rectangleLoop({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const walk = Field.walk(F, C);

    expect(walk.contributions).toHaveLength(4);
    near(walk.total, 2);
    near(
      walk.contributions.reduce((s, c) => s + c.amount, 0),
      2,
    );

    // replaying it is what `demonstrate` does — one event per edge
    const events = world.trace(walk);
    expect(events.filter((e) => e.type === 'contribution:derive')).toHaveLength(4);
  });
});

describe('the curl probe', () => {
  it('circulation density converges to curl as the radius shrinks', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    // curl[0, x^3] = 3x^2, so at x = 1.5 the limit is 6.75. Curl VARIES over
    // the probe disk, so a big loop reports the average and only a shrinking
    // one converges — which is the point of the beat.
    const F = Field.vectorField((x) => [0, x * x * x]);
    const r = createParameter(world, 'r', 1, [0, 2]);
    const probe = Field.circulationDensity(F, { at: [1.5, 0], radius: r });

    near(probe.curl.value, 6.75);
    const coarse = Math.abs(probe.density.value - 6.75);
    expect(coarse).toBeGreaterThan(0.1);
    r.setValueLive(0.05);
    const fine = Math.abs(probe.density.value - 6.75);
    expect(fine).toBeLessThan(coarse);
    near(probe.density.value, 6.75, 0.02);
  });

  it('at radius zero the density reads the limit instead of NaN', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const F = Field.vectorField((x, y) => [-y, x]);
    const r = createParameter(world, 'r', 0.5, [0, 2]);
    const probe = Field.circulationDensity(F, { at: [0, 0], radius: r });
    r.setValueLive(0);
    expect(Number.isNaN(probe.density.value)).toBe(false);
    near(probe.density.value, 2);
  });
});

describe('tiling with shared-edge identity', () => {
  it('adjacent cells hold the SAME edge handle, walked opposite ways', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const R = Field.rectangle({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const T = Field.tile(R, { n: 2 });

    expect(T.tiles).toHaveLength(4);
    // cell (0,0)'s top edge and cell (1,0)'s bottom edge are one segment
    const topOfLower = T.tile(0, 0).boundary.segments[2]!;
    const bottomOfUpper = T.tile(1, 0).boundary.segments[0]!;
    expect(topOfLower.id).toBe(bottomOfUpper.id);
    expect(topOfLower.orientation).toBe(-1);
    expect(bottomOfUpper.orientation).toBe(1);
  });

  it('splits its edges into the ones that cancel and the ones that survive', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const T = Field.tile(Field.rectangle({ x0: 0, y0: 0, x1: 1, y1: 1 }), { n: 3 });

    // a 3x3 lattice: 4 rows x 3 + 4 cols x 3 = 24 edges, 12 on the boundary
    expect(T.boundaryEdges).toHaveLength(12);
    expect(T.interiorEdges).toHaveLength(12);
    // every interior edge is held by exactly two cells; boundary edges by one
    const held = new Map<string, number>();
    for (const t of T.tiles) {
      for (const s of t.boundary.segments) held.set(s.id, (held.get(s.id) ?? 0) + 1);
    }
    expect(T.interiorEdges.every((s) => held.get(s.id) === 2)).toBe(true);
    expect(T.boundaryEdges.every((s) => held.get(s.id) === 1)).toBe(true);
  });

  it('interior contributions cancel exactly — the cancellation beat, checked', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const F = Field.vectorField((x, y) => [-y * y, x * y]);
    const T = Field.tile(Field.rectangle({ x0: 0, y0: 0, x1: 2, y1: 2 }), { n: 4 });

    for (const edge of T.interiorEdges) {
      const forward = Field.contribution(F, edge);
      const backward = Field.contribution(F, edge.reversed());
      near(forward.value + backward.value, 0, 1e-12);
    }
  });

  it('the cells sum to the boundary circulation — Green, assembled', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const F = Field.vectorField((x, y) => [-y * y, x * y]);
    const R = Field.rectangle({ x0: 0, y0: 0, x1: 2, y1: 2 });
    const T = Field.tile(R, { n: 6 });

    const summed = T.tiles.reduce((s, t) => s + Field.circulation(F, t.boundary).value, 0);
    const around = Field.circulation(F, R.boundary).value;
    near(summed, around, 1e-9);
  });

  it('the traced sweep emits one event per cell and totals the same', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const F = Field.vectorField((x, y) => [-y, x]);
    const R = Field.rectangle({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const T = Field.tile(R, { n: 3 });
    const walk = Field.walkTiles(F, T);

    expect(walk.cells).toHaveLength(9);
    near(walk.total, Field.circulation(F, R.boundary).value);
    expect(world.trace(walk).filter((e) => e.type === 'tile:derive')).toHaveLength(9);
  });

  it('the tiling follows a region whose corner is dragged', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const w = createParameter(world, 'w', 1, [0, 4]);
    const F = Field.vectorField((x, y) => [-y, x]);
    const R = Field.rectangle({ x0: 0, y0: 0, x1: w, y1: 1 });
    const T = Field.tile(R, { n: 2 });
    const summed = (): number => T.tiles.reduce((s, t) => s + Field.circulation(F, t.boundary).value, 0);

    near(summed(), 2);
    w.setValueLive(3);
    near(summed(), 6);
  });
});

// ── the differential half (step 2.5) ──

describe('Field.gradient', () => {
  it('is the field of steepest ascent, and it is curl-free', () => {
    const Field = createFieldLib(createWorld());
    // f = x^2 + 3y^2 ⇒ ∇f = [2x, 6y]
    const f = Field.scalarField((x, y) => x * x + 3 * y * y, { label: 'f' });
    const g = Field.gradient(f);
    const [u, v] = g.at(2, -1);
    near(u, 4);
    near(v, -6);
    // every gradient field has zero curl — the same fact the Green tests lean
    // on, arrived at from the differential side this time.
    near(Field.curl(g).at(1.3, 0.7), 0, 1e-2);
  });

  it('vanishes exactly at a critical point, which is how a claim finds one', () => {
    const Field = createFieldLib(createWorld());
    const f = Field.scalarField((x, y) => (x - 1) * (x - 1) + (y + 2) * (y + 2));
    const g = Field.gradient(f);
    expect(g.magnitudeAt(1, -2).value).toBeLessThan(1e-6);
    expect(g.magnitudeAt(1.5, -2).value).toBeGreaterThan(0.5);
  });
});

describe('Field.hessian', () => {
  it('is the matrix of second partials', () => {
    const Field = createFieldLib(createWorld());
    // f = x^2 + 4xy + y^2 ⇒ H = [[2, 4], [4, 2]] everywhere
    const f = Field.scalarField((x, y) => x * x + 4 * x * y + y * y);
    const H = Field.hessian(f, [0.5, -1]);
    near(H.cell(0, 0).value, 2, 1e-3);
    near(H.cell(1, 1).value, 2, 1e-3);
    near(H.cell(0, 1).value, 4, 1e-3);
    // symmetric by construction — literally the same handle
    expect(H.cell(0, 1).id).toBe(H.cell(1, 0).id);
  });

  it('follows the point it is evaluated at', () => {
    const world = createWorld();
    const Field = createFieldLib(world);
    const a = createParameter(world, 'a', 1, [-3, 3]);
    // f = x^3 ⇒ f_xx = 6x, so the Hessian moves with the point
    const f = Field.scalarField((x) => x * x * x);
    const H = Field.hessian(f, [a, 0]);
    near(H.cell(0, 0).value, 6, 1e-2);
    a.setValueLive(-2);
    near(H.cell(0, 0).value, -12, 1e-2);
  });
});
