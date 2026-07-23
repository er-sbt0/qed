/**
 * linalg.test.ts — the linear-algebra library: det = ad − bc live under a
 * dragged entry, signed area (orientation in the sign), area ratio = |det|,
 * the det = 0 collapse, 2×2 eigenvalues, det(AB) = det A · det B, and the
 * per-vertex maps-to provenance that makes the square→parallelogram morph legal.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { World } from '@math-ai/core';
import { createLinearAlgebra, eigen2x2, signedArea } from './linalg.js';
import type { LinAlgLib, Matrix2 } from './linalg.js';
import { createProbability } from './probability.js';
import type { StochasticMatrix } from './probability.js';
import { createParameter } from './parameter.js';

function setup(): { world: World; LinAlg: LinAlgLib } {
  const world = createWorld();
  return { world, LinAlg: createLinearAlgebra(world) };
}

describe('det — reactive ad − bc', () => {
  it('literal matrix determinant', () => {
    const { LinAlg } = setup();
    const T = LinAlg.linearMap(LinAlg.matrix([[2, 1], [0, 1]]));
    expect(T.det.value).toBe(2);
  });

  it('recomputes when a parameter entry is dragged', () => {
    const { world, LinAlg } = setup();
    const a = createParameter(world, 'a', 2, [-3, 3]);
    const c = createParameter(world, 'c', 0, [-3, 3]);
    const T = LinAlg.linearMap(LinAlg.matrix([[a, 1], [c, 1]]));
    expect(T.det.value).toBe(2); // 2·1 − 1·0
    c.setValue(2);
    expect(T.det.value).toBe(0); // 2·1 − 1·2  → singular
    c.setValue(3);
    expect(T.det.value).toBe(-1); // orientation reversed
  });
});

describe('signed area and the area ratio', () => {
  it('unit square has signed area +1 (CCW)', () => {
    const { LinAlg } = setup();
    expect(LinAlg.unitSquare().area.value).toBeCloseTo(1, 12);
  });

  it('area after transformation equals det (the |det| = ratio story)', () => {
    const { LinAlg } = setup();
    const T = LinAlg.linearMap(LinAlg.matrix([[2, 1], [0, 1]]));
    const image = T.apply(LinAlg.unitSquare());
    expect(image.area.value).toBeCloseTo(2, 12); // area before = 1
    expect(image.area.value).toBeCloseTo(T.det.value, 12);
  });

  it('negative det flips the signed area (orientation reversal)', () => {
    const { LinAlg } = setup();
    const flip = LinAlg.linearMap(LinAlg.matrix([[1, 0], [0, -1]]));
    const image = flip.apply(LinAlg.unitSquare());
    expect(image.area.value).toBeCloseTo(-1, 12);
  });

  it('singular map collapses the area to 0 (dimension destroyed)', () => {
    const { LinAlg } = setup();
    const singular = LinAlg.linearMap(LinAlg.matrix([[1, 1], [1, 1]]));
    const image = singular.apply(LinAlg.unitSquare());
    expect(image.area.value).toBeCloseTo(0, 12);
  });

  it('the image deforms live when the matrix is dragged', () => {
    const { world, LinAlg } = setup();
    const a = createParameter(world, 'a', 1, [-3, 3]);
    const T = LinAlg.linearMap(LinAlg.matrix([[a, 0], [0, 1]]));
    const image = T.apply(LinAlg.unitSquare());
    expect(image.area.value).toBeCloseTo(1, 12);
    a.setValue(3);
    expect(image.area.value).toBeCloseTo(3, 12); // area tripled
  });
});

describe('apply — maps-to provenance (morph legality)', () => {
  it('records a maps-to edge from each image vertex back to its source vertex', () => {
    const { world, LinAlg } = setup();
    const square = LinAlg.unitSquare();
    const T = LinAlg.linearMap(LinAlg.matrix([[2, 1], [0, 1]]));
    const image = T.apply(square);
    for (let i = 0; i < square.vertices.length; i += 1) {
      expect(world.graph.reachable(image.vertices[i]!, square.vertices[i]!)).toBe(true);
    }
  });
});

describe('eigen — 2×2 decomposition', () => {
  it('diagonal matrix eigenvalues are the diagonal', () => {
    const r = eigen2x2(2, 0, 0, 3);
    expect(r.real).toBe(true);
    expect(r.values[0]).toBeCloseTo(3, 12);
    expect(r.values[1]).toBeCloseTo(2, 12);
  });

  it('a rotation (complex spectrum) reports real:false', () => {
    const r = eigen2x2(0, -1, 1, 0); // 90° rotation
    expect(r.real).toBe(false);
  });

  it('eigenvectors satisfy A v = λ v', () => {
    const r = eigen2x2(2, 1, 0, 3);
    const [l1] = r.values;
    const v = r.vectors[0];
    const av = { x: 2 * v.x + 1 * v.y, y: 0 * v.x + 3 * v.y };
    expect(av.x).toBeCloseTo(l1 * v.x, 9);
    expect(av.y).toBeCloseTo(l1 * v.y, 9);
  });

  it('reactive eigen follows the matrix', () => {
    const { world, LinAlg } = setup();
    const d = createParameter(world, 'd', 3, [-5, 5]);
    const eig = LinAlg.eigen(LinAlg.matrix([[2, 0], [0, d]]));
    expect(eig.values[0].value).toBeCloseTo(3, 12);
    d.setValue(5);
    expect(eig.values[0].value).toBeCloseTo(5, 12);
  });

  /**
   * The papercut step 2.5 fixed: `values` used to be a live getter returning
   * raw numbers, so a readout of an eigenvalue threw and a claim over one
   * silently snapshotted. They are handles now, and the handle IDENTITY is
   * stable across reads — a fresh handle per read would defeat both.
   */
  it('eigenvalues are NumericHandles, stable in identity and live in value', () => {
    const { world, LinAlg } = setup();
    const d = createParameter(world, 'd', 3, [-5, 5]);
    const eig = LinAlg.eigen(LinAlg.matrix([[2, 0], [0, d]]));
    const lambda = eig.values[0];
    expect(typeof lambda.id).toBe('string');
    expect(eig.values[0].id).toBe(lambda.id);
    d.setValue(5);
    expect(lambda.value).toBeCloseTo(5, 12);
  });
});

describe('compose — multiplicativity', () => {
  it('det(AB) = det(A)·det(B), reactively', () => {
    const { world, LinAlg } = setup();
    const a = createParameter(world, 'a', 2, [-3, 3]);
    const A = LinAlg.linearMap(LinAlg.matrix([[a, 1], [0, 1]]));
    const B = LinAlg.linearMap(LinAlg.matrix([[1, 1], [0, 2]]));
    const AB = LinAlg.compose(A, B);
    expect(AB.det.value).toBeCloseTo(A.det.value * B.det.value, 12); // 2·2 = 4
    a.setValue(-1);
    expect(AB.det.value).toBeCloseTo(A.det.value * B.det.value, 12);
  });
});

describe('signedArea helper', () => {
  it('is orientation-sensitive', () => {
    const ccw = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(signedArea(ccw)).toBeCloseTo(1, 12);
    expect(signedArea([...ccw].reverse())).toBeCloseTo(-1, 12);
  });
});

describe('a Prob stochastic matrix is not a Matrix2', () => {
  /**
   * Regression for a live generation that wrote
   * `LinAlg.eigen(P as unknown as Matrix2)` to get a chain's second
   * eigenvalue. Both types are Handle<'matrix'>, so the cast compiled and the
   * static gate saw 175 clean lines; the throw arrived a line later, on first
   * read of `.values`, as `matrix has no state labeled "undefined"`.
   */
  function chain(): StochasticMatrix {
    const world = createWorld();
    const Prob = createProbability(world);
    const states = Prob.states(['A', 'B']);
    return Prob.stochasticMatrix({ states, values: [[0.7, 0.3], [0.4, 0.6]] });
  }

  it('eigen rejects it eagerly, naming the confusion and the way out', () => {
    const { LinAlg } = setup();
    const P = chain();
    expect(() => LinAlg.eigen(P as unknown as Matrix2)).toThrow(/Prob stochastic matrix/);
    expect(() => LinAlg.eigen(P as unknown as Matrix2)).toThrow(/Prob\.stationary/);
  });

  it('det rejects it too — both funnel through asMatrix', () => {
    const { LinAlg } = setup();
    expect(() => LinAlg.det(chain() as unknown as Matrix2)).toThrow(/Prob stochastic matrix/);
  });

  it('the old failure mode is gone: it no longer dies later at .values', () => {
    const { LinAlg } = setup();
    let thrown: Error | undefined;
    try {
      LinAlg.eigen(chain() as unknown as Matrix2);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown?.message).not.toMatch(/no state labeled/);
  });

  it('a real Matrix2 still passes through untouched', () => {
    const { LinAlg } = setup();
    expect(LinAlg.eigen(LinAlg.matrix([[2, 0], [0, 3]])).values.map((v) => v.value)).toEqual([3, 2]);
  });
});
