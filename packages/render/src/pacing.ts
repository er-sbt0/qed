/**
 * pacing.ts — pure timing math: pace rates → milliseconds, cascade pacing
 * curves (slow→fast interpolation across iterations), and `over` duration
 * parsing. Pure so it unit-tests without a browser.
 */

import type { Pace, PaceRate } from '@math-ai/core';

export const PACE_MS: Readonly<Record<PaceRate, number>> = Object.freeze({
  slow: 900,
  medium: 450,
  fast: 180,
});

/** Milliseconds for one step at a given rate (default medium). */
export function paceMs(rate?: PaceRate): number {
  return PACE_MS[rate ?? 'medium'];
}

/**
 * Per-iteration durations for a cascade: linear interpolation from the pace's
 * start rate to its end rate across the iterations. `{start: 'slow', end:
 * 'fast'}` is the spike idiom — the stream begins deliberately and
 * accelerates. A single-rate pace (or none) is uniform; one iteration takes
 * the start rate.
 */
export function cascadeDurations(count: number, pace?: Pace): number[] {
  if (count <= 0) return [];
  const start = paceMs(pace?.start);
  const end = paceMs(pace?.end ?? pace?.start);
  if (count === 1) return [start];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    out.push(Math.round(start + (end - start) * t));
  }
  return out;
}

/** Parse a duration hint like "2s" / "350ms" / "0.5s". Undefined if absent/invalid. */
export function parseOver(over?: string): number | undefined {
  if (!over) return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*$/.exec(over);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 's' ? Math.round(n * 1000) : Math.round(n);
}
