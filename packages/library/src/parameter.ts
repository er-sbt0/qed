/**
 * parameter.ts — `M.parameter`, the Δ3 kernel addition the FTC and determinant
 * spikes forced (see spikes/ftc/FINDINGS.md, Δ3.1).
 *
 * A `Parameter` is the *interaction-mutable* scalar: a named number with a
 * range that downstream reactive numerics depend on (the dragged x, the shrunk
 * Δx, the matrix entries a/b/c/d). It is the discipline-neutral generalization
 * of the Markov matrix cell — a `VarySettable` (so `lesson.vary` / `expose`
 * work on it unchanged) backed by a core `Slot<number>` (so `world.derived`
 * that reads `.value` re-runs when it moves). Interaction policy is the clamp
 * to `range`, owned by the object, exactly as the matrix cell owns
 * renormalize-row.
 */

import type { World } from '@math-ai/core';
import type { VarySettable } from '@math-ai/lesson';

export interface Parameter extends VarySettable {
  readonly kind: 'parameter';
  readonly label: string;
  readonly range: readonly [number, number];
  /**
   * The id of the backing core slot — the ROOT the reactive graph bottoms out
   * at, so `whyChanged` can attribute a bare `slot#n` edge to this parameter.
   * The id only, deliberately: handing out the Slot itself would hand out an
   * unclamped `set` around the clamp policy this object exists to own.
   */
  readonly cellId: string;
  /** Untracked read (drag path / views that repaint without subscribing). */
  peek(): number;
  /** Apply on the interaction path — clamped, but no timeline step. */
  setValueLive(next: number): void;
}

function clamp(x: number, [lo, hi]: readonly [number, number]): number {
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

export function createParameter(
  world: World,
  name: string,
  value: number,
  range: readonly [number, number],
): Parameter {
  const slot = world.slot(clamp(value, range));
  const base = world.handle('parameter');
  return Object.freeze({
    id: base.id,
    kind: 'parameter' as const,
    label: name,
    range,
    cellId: slot.id,
    get value(): number {
      return slot.value; // tracked — reactive derived numerics depend on this
    },
    peek(): number {
      return slot.peek();
    },
    setValue(next: number): void {
      // the object's interaction policy: clamp to range so invalid states are
      // unreachable at the boundary (the drag never feeds a derived garbage).
      slot.set(clamp(next, range));
    },
    setValueLive(next: number): void {
      // the INTERACTION path: same policy, no timeline step. A drag frame is
      // not a beat of the explanation; `Slot.poke` invalidates dependents so
      // reactive numerics recompute and views repaint via applyState().
      slot.poke(clamp(next, range));
    },
  });
}
