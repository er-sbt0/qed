/**
 * frame.test.ts — the frame-craft primitives added for roadmap step (a):
 * nice-number ticks, the number formatter, and the vertical band scale. These
 * are pure functions over numbers, so the tests need no stage/DOM.
 */

import { describe, expect, it } from 'vitest';
import { createFrame, formatNumber, niceTicks } from './frame.js';

describe('niceTicks', () => {
  it('covers [0, 6] with a nice step that includes both ends', () => {
    const ticks = niceTicks(0, 6);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(6);
    // consecutive gaps are all equal — a single nice step throughout
    const step = ticks[1]! - ticks[0]!;
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(step, 9);
    }
    expect([1, 2].includes(step)).toBe(true); // 1/2/5 × 10ⁿ family
  });

  it('a [0, 1] span includes both 0 and 1', () => {
    const ticks = niceTicks(0, 1);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(1);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it('never ticks outside the requested span', () => {
    const ticks = niceTicks(0.3, 5.7);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(t).toBeLessThanOrEqual(5.7 + 1e-9);
    }
  });

  it('a degenerate span (lo === hi) returns a single tick, not NaN or a crash', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it('handles negative ranges symmetrically', () => {
    const ticks = niceTicks(-6, 6);
    expect(ticks).toContain(0);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(-4);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(4);
    // symmetric about zero
    const sorted = [...ticks].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      expect(sorted[i]).toBeCloseTo(-sorted[sorted.length - 1 - i]!, 9);
    }
  });

  it('tolerates a reversed (hi, lo) argument order', () => {
    expect(niceTicks(6, 0)).toEqual(niceTicks(0, 6));
  });

  it('respects a smaller target tick count', () => {
    const coarse = niceTicks(0, 100, 3);
    const fine = niceTicks(0, 100, 9);
    expect(coarse.length).toBeLessThan(fine.length);
  });
});

describe('formatNumber', () => {
  it('trims float noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('trims trailing zeros', () => {
    expect(formatNumber(2.0)).toBe('2');
    expect(formatNumber(1.5)).toBe('1.5');
  });

  it('renders -0 as 0', () => {
    expect(formatNumber(-0)).toBe('0');
  });
});

describe('frame.bands', () => {
  it('returns `count` bands, centres strictly inside the inner width', () => {
    const frame = createFrame([0, 1], [0, 1], { width: 320, height: 220, pad: 20 });
    const bands = frame.bands(4);
    expect(bands).toHaveLength(4);
    for (const b of bands) {
      expect(b.center).toBeGreaterThan(20); // pad
      expect(b.center).toBeLessThan(300); // width - pad
      expect(b.hi - b.lo).toBeCloseTo(b.width, 9);
    }
  });

  it('bands do not overlap and read left to right', () => {
    const frame = createFrame([0, 1], [0, 1], { width: 320, height: 220, pad: 20 });
    const bands = frame.bands(5);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]!.lo).toBeGreaterThanOrEqual(bands[i - 1]!.hi);
      expect(bands[i]!.center).toBeGreaterThan(bands[i - 1]!.center);
    }
  });

  it('more padding narrows each band without moving its centre', () => {
    const frame = createFrame([0, 1], [0, 1], { width: 320, height: 220, pad: 20 });
    const tight = frame.bands(3, { padding: 0.05 });
    const loose = frame.bands(3, { padding: 0.5 });
    for (let i = 0; i < 3; i += 1) {
      expect(loose[i]!.width).toBeLessThan(tight[i]!.width);
      expect(loose[i]!.center).toBeCloseTo(tight[i]!.center, 6);
    }
  });

  it('a single band spans the middle of the inner width', () => {
    const frame = createFrame([0, 1], [0, 1], { width: 320, height: 220, pad: 20 });
    const [b] = frame.bands(1);
    expect(b!.center).toBeCloseTo(160, 6); // (20 + 300) / 2
  });
});
