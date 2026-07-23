/**
 * budget.ts — the per-frame interrupt budget, the heart of milestone 5.
 *
 * With live closures a program can hang or diverge at frame 200 of a drag.
 * "Fail the whole answer" is wrong once the answer has rendered. So every
 * stretch of guest execution runs inside a `frame` whose wall-time and
 * bytecode-op ceilings are enforced by QuickJS's interrupt handler:
 *
 *     rt.setInterruptHandler(() => Date.now() - frameStart > BUDGET_MS)
 *
 * When the budget fires, QuickJS throws `InternalError: interrupted` into the
 * guest, which surfaces to the host as a `GuestError(interrupted=true)`. The
 * frame runner (`degradeFrame`) catches it and keeps the last good frame —
 * freeze, never tear down. Non-finite results (a divide-by-zero mid-drag) are
 * clamped the same way. The program stays alive; the next frame can recover.
 */

import type { QuickJSRuntime } from 'quickjs-emscripten-core';
import { GuestError } from './protocol.js';

export interface BudgetOpts {
  /** Wall-time ceiling per frame, ms. */
  readonly frameMs?: number;
  /** Wall-time ceiling for the one-shot authoring pass, ms. */
  readonly authorMs?: number;
  /** Interrupt-tick ceiling per frame (a bytecode-op proxy: N ticks ⇒ abort). */
  readonly maxTicks?: number;
}

const DEFAULTS = { frameMs: 16, authorMs: 5000, maxTicks: 2_000_000 } as const;

export class FrameBudget {
  readonly frameMs: number;
  readonly authorMs: number;
  readonly maxTicks: number;

  private deadline = Infinity;
  private ticks = 0;
  private tickCeiling = Infinity;
  /** Diagnostics: how many interrupt ticks the last frame consumed. */
  lastTicks = 0;

  constructor(opts: BudgetOpts = {}) {
    this.frameMs = opts.frameMs ?? DEFAULTS.frameMs;
    this.authorMs = opts.authorMs ?? DEFAULTS.authorMs;
    this.maxTicks = opts.maxTicks ?? DEFAULTS.maxTicks;
  }

  /** Install the interrupt handler; QuickJS calls it every N bytecode ops. */
  install(runtime: QuickJSRuntime): void {
    runtime.setInterruptHandler(() => {
      this.ticks += 1;
      if (this.ticks > this.tickCeiling) return true;
      return Date.now() > this.deadline;
    });
  }

  /** Open a budget window of `ms` wall-time (and the tick ceiling). */
  begin(ms: number): void {
    this.deadline = Date.now() + ms;
    this.ticks = 0;
    this.tickCeiling = this.maxTicks;
  }

  /** Close the window (no interrupt until the next `begin`). */
  end(): void {
    this.lastTicks = this.ticks;
    this.deadline = Infinity;
    this.tickCeiling = Infinity;
  }
}

export type FrameStatus = 'ok' | 'frozen-interrupt' | 'frozen-throw' | 'clamped-nonfinite';

export interface FrameResult<T> {
  readonly value: T;
  readonly status: FrameStatus;
  /** True whenever the frame did NOT accept a fresh good value. */
  readonly degraded: boolean;
}

/**
 * Run one interaction frame's guest computation under the budget, degrading
 * gracefully instead of failing:
 *   - interrupt (budget exceeded)  ⇒ freeze on `last`
 *   - guest throw                  ⇒ freeze on `last`
 *   - non-finite numeric result    ⇒ clamp to `last`
 *   - otherwise                    ⇒ accept the new value
 * `compute` is the retained guest closure (wrapped by the bridge). `isFinite`
 * decides whether a value is acceptable (defaults to Number.isFinite for
 * numeric frames).
 */
export function degradeFrame<T>(
  budget: FrameBudget,
  last: T,
  compute: () => T,
  opts: { readonly frameMs?: number; readonly accept?: (v: T) => boolean } = {},
): FrameResult<T> {
  const accept = opts.accept ?? ((v: T) => typeof v !== 'number' || Number.isFinite(v));
  budget.begin(opts.frameMs ?? budget.frameMs);
  try {
    const value = compute();
    if (!accept(value)) {
      return { value: last, status: 'clamped-nonfinite', degraded: true };
    }
    return { value, status: 'ok', degraded: false };
  } catch (err) {
    const interrupted = err instanceof GuestError && err.interrupted;
    return {
      value: last,
      status: interrupted ? 'frozen-interrupt' : 'frozen-throw',
      degraded: true,
    };
  } finally {
    budget.end();
  }
}
