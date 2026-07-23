import { describe, expect, it } from 'vitest';
import { PACE_MS, cascadeDurations, paceMs, parseOver } from './pacing.js';

describe('paceMs', () => {
  it('maps rates to durations, defaulting to medium', () => {
    expect(paceMs('slow')).toBe(PACE_MS.slow);
    expect(paceMs('fast')).toBe(PACE_MS.fast);
    expect(paceMs()).toBe(PACE_MS.medium);
  });
});

describe('cascadeDurations', () => {
  it('interpolates slow→fast monotonically across iterations', () => {
    const ds = cascadeDurations(6, { start: 'slow', end: 'fast' });
    expect(ds).toHaveLength(6);
    expect(ds[0]).toBe(PACE_MS.slow);
    expect(ds[5]).toBe(PACE_MS.fast);
    for (let i = 1; i < ds.length; i += 1) expect(ds[i]!).toBeLessThan(ds[i - 1]!);
  });

  it('is uniform without a pace, and start-rated when only start is given', () => {
    expect(cascadeDurations(3)).toEqual([PACE_MS.medium, PACE_MS.medium, PACE_MS.medium]);
    expect(cascadeDurations(3, { start: 'fast' })).toEqual([
      PACE_MS.fast,
      PACE_MS.fast,
      PACE_MS.fast,
    ]);
  });

  it('handles the degenerate counts', () => {
    expect(cascadeDurations(0, { start: 'slow', end: 'fast' })).toEqual([]);
    expect(cascadeDurations(1, { start: 'slow', end: 'fast' })).toEqual([PACE_MS.slow]);
  });
});

describe('parseOver', () => {
  it('parses seconds and milliseconds', () => {
    expect(parseOver('2s')).toBe(2000);
    expect(parseOver('0.5s')).toBe(500);
    expect(parseOver('350ms')).toBe(350);
  });

  it('rejects garbage and absence', () => {
    expect(parseOver(undefined)).toBeUndefined();
    expect(parseOver('fast')).toBeUndefined();
    expect(parseOver('2 minutes')).toBeUndefined();
  });
});
