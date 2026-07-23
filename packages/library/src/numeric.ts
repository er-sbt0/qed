/**
 * numeric.ts — the scalar specialization of `live.ts`.
 *
 * A `LabeledNumber` is a `Live<number>` (which is what `NumericHandle` now
 * IS — see packages/lesson/src/types.ts) whose `.value` re-reads a
 * `world.derived`. det/area/accumulation/average-rate are all `derivedNumber`s,
 * so a dragged Parameter recomputes them on the next read exactly as
 * `Prob.stationary` recomputes π.
 *
 * This file used to hold the reactive wrapper itself, and being scalar-only
 * was the constraint roadmap step 3 removed. It is kept as its own module
 * because `kind: 'scalar'` is a real contract — `View.readout` and `M.claim`
 * check for a numeric `.value`, and the whole calculus/linalg surface is
 * typed against `LabeledNumber` rather than `LiveValue<number>`.
 */

import type { World } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import { isLive, live, constLive } from './live.js';

export interface LabeledNumber extends NumericHandle {
  readonly kind: 'scalar';
  readonly label?: string;
}

/** A live reactive scalar: `.value` re-reads a derived that tracks its inputs. */
export function derivedNumber(world: World, fn: () => number, label?: string): LabeledNumber {
  return live<number>(world, fn, { label, kind: 'scalar' }) as LabeledNumber;
}

/** A constant scalar handle (a literal matrix entry, a fixed width). */
export function constNumber(world: World, value: number, label?: string): LabeledNumber {
  return constLive<number>(world, value, { label, kind: 'scalar' }) as LabeledNumber;
}

/** Read a number or a NumericHandle uniformly (tracked when it is a handle). */
export function numOf(x: number | NumericHandle): number {
  return isLive(x) ? x.value : x;
}
