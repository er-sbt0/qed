import { describe, expect, it } from 'vitest';
import { edgeBends, edgeGeometry, layoutGraph, selfLoopGeometry } from './graph.js';

const opts = { width: 300, height: 230 };

describe('layoutGraph', () => {
  it('is deterministic: same inputs, same positions', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const p1 = layoutGraph(nodes, edges, opts);
    const p2 = layoutGraph(nodes, edges, opts);
    expect([...p1.entries()]).toEqual([...p2.entries()]);
  });

  it('keeps every node inside the padded bounds, finite, and distinct', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
      { from: 'd', to: 'd' }, // self-loop exerts no force but must not break
    ];
    const pos = layoutGraph(nodes, edges, opts);
    expect(pos.size).toBe(5);
    for (const [, p] of pos) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(300);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(230);
    }
    const keys = [...pos.values()].map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('separates connected nodes by a sane distance', () => {
    const pos = layoutGraph(['a', 'b'], [{ from: 'a', to: 'b' }], opts);
    const a = pos.get('a')!;
    const b = pos.get('b')!;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(d).toBeGreaterThan(60); // room for two r=22 nodes and an arrow
  });

  it('handles empty and singleton graphs', () => {
    expect(layoutGraph([], [], opts).size).toBe(0);
    const single = layoutGraph(['only'], [], opts);
    expect(single.get('only')).toEqual({ x: 150, y: 115 });
  });
});

describe('edgeBends', () => {
  it('directed: reciprocal pairs bow, lone edges and self-loops stay straight', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'c' },
    ];
    expect(edgeBends(edges, true)).toEqual([16, 16, 0, 0]);
  });

  it('undirected: a single edge per pair is straight — no phantom reciprocals', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    expect(edgeBends(edges, false)).toEqual([0, 0]);
  });

  it('undirected: parallel edges over one pair fan out, whatever their orientation', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' }, // same unordered pair
      { from: 'a', to: 'b' },
    ];
    expect(edgeBends(edges, false)).toEqual([0, 16, -16]);
  });
});

describe('edge geometry', () => {
  it('straight edges trim endpoints to the node circles', () => {
    const geo = edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 0);
    expect(geo.path).toBe('M 20.00 0.00 L 80.00 0.00');
  });

  it('bent edges are quadratic and bow perpendicular to the segment', () => {
    const geo = edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 16);
    expect(geo.path).toMatch(/^M .* Q 50\.00 16\.00 .*$/);
    // reversed direction bows to the opposite side
    const reverse = edgeGeometry({ x: 100, y: 0 }, { x: 0, y: 0 }, 20, 16);
    expect(reverse.path).toMatch(/Q 50\.00 -16\.00/);
  });

  it('self-loops arc above the node by default and place their label beyond the arc', () => {
    const geo = selfLoopGeometry({ x: 50, y: 100 }, 22);
    expect(geo.path).toMatch(/^M .* A .* 1 1 .*$/); // large-arc sweep
    expect(geo.label.y).toBeLessThan(100 - 22); // above the node
    expect(geo.label.x).toBe(50);
  });

  it('self-loops orient along the given outward direction', () => {
    const down = selfLoopGeometry({ x: 50, y: 100 }, 22, { x: 0, y: 1 });
    expect(down.label.y).toBeGreaterThan(100 + 22); // below the node
    const right = selfLoopGeometry({ x: 50, y: 100 }, 22, { x: 1, y: 0 });
    expect(right.label.x).toBeGreaterThan(50 + 22);
    expect(right.label.y).toBeCloseTo(100, 6);
  });
});
