/**
 * live.ts — the library's ONE reactive wrapper, for any type.
 *
 * `derivedNumber` used to be the only one, and everything live that was not a
 * number got faked around it (roadmap step 3's ledger): a claim's verdict was
 * a getter over a bare `world.derived`, a segment's endpoints were plain
 * closures re-run on every read, a Hessian's entries and an eigen-pair the
 * same. Those fakes all cost the same three things — no memoization, no
 * equality, and no handle to hang a correspondence or a view subscription on.
 *
 * So this file is deliberately small and deliberately general. `live<T>` mints
 * a `Live<T>` handle over `world.derived`, which was already generic; the
 * scalar-only constraint lived in the wrapper, not in core. `derivedNumber` in
 * numeric.ts is now a one-line specialization of it, and that is what makes
 * this an extraction rather than a second mechanism.
 *
 * EQUALITY is the part worth reading. A derived over a structural value (a
 * point, a list of points) re-runs and allocates a NEW array every time, so
 * without an `equals` every dependent invalidates on every read and nothing
 * downstream can ever short-circuit. `vec2Equals`/`listEquals` are the two
 * shapes the plane geometry actually uses; pass one when T is structural.
 */

import type { Derived, World } from '@math-ai/core';
import type { Live } from '@math-ai/lesson';

export type { Live };

/** A `Live<T>` carrying the kind and label the views and readouts display. */
export interface LiveValue<T> extends Live<T> {
  readonly kind: string;
  readonly label?: string;
  /**
   * The backing derived cell — absent on `constLive`, which has no
   * computation behind it. This is what makes the reactive graph reachable
   * FROM a handle: `whyChanged` (roadmap 4c) starts at `cell` and walks
   * `dependsOn()` back to the inputs that moved. Read-only plumbing; a
   * program has no reason to touch it and the reference does not teach it.
   */
  readonly cell?: Derived<T>;
}

export interface LiveOpts<T> {
  readonly label?: string;
  /** Handle kind. Defaults to `'live'`; numerics pass `'scalar'`. */
  readonly kind?: string;
  /** Short-circuit for structural T — see the note above. */
  readonly equals?: (a: T, b: T) => boolean;
}

/** A live value computed from other reactive cells; `fn` is tracked on read. */
export function live<T>(world: World, fn: () => T, opts?: LiveOpts<T>): LiveValue<T> {
  const d = world.derived(fn, opts?.equals ? { equals: opts.equals } : undefined);
  const kind = opts?.kind ?? 'live';
  const base = world.handle(kind);
  return Object.freeze({
    id: base.id,
    kind,
    get value(): T {
      return d.value;
    },
    label: opts?.label,
    cell: d,
  });
}

/** A constant live value — a literal that still needs a handle. */
export function constLive<T>(world: World, value: T, opts?: LiveOpts<T>): LiveValue<T> {
  const kind = opts?.kind ?? 'live';
  const base = world.handle(kind);
  return Object.freeze({ id: base.id, kind, value, label: opts?.label });
}

/**
 * Read a raw value or a `Live` of it uniformly (tracked when it is live).
 *
 * The guard has to be structural rather than `instanceof`, because everything
 * in this library is a frozen object literal. `kind` is not enough either —
 * a Live<T> and its subject can share one.
 */
export function valueOf<T>(x: T | Live<T>): T {
  return isLive(x) ? x.value : x;
}

export function isLive<T>(x: T | Live<T>): x is Live<T> {
  return (
    typeof x === 'object' &&
    x !== null &&
    'value' in (x as object) &&
    typeof (x as { id?: unknown }).id === 'string'
  );
}

// ───────────────────────────── equality ─────────────────────────────

/** Exact equality for a plane point. Exact on purpose: these come from the
 *  same arithmetic on the same cells, so a tolerance would only mask a real
 *  move by less than epsilon. */
export function vec2Equals(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Elementwise equality over lists, given an equality for the element. */
export function listEquals<T>(eq: (a: T, b: T) => boolean) {
  return (a: readonly T[], b: readonly T[]): boolean =>
    a.length === b.length && a.every((x, i) => eq(x, b[i]!));
}

export const vec2ListEquals = listEquals(vec2Equals);
