/**
 * host.ts — the QuickJS host. The same lesson programs that ran in-process at
 * milestone 4 now execute as sandboxed guest code, marshalled through the
 * `Bridge`, guarded by the `FrameBudget`.
 *
 * Lifecycle (mirrors the M4 harness, one layer down):
 *   1. host makes the REAL world + stage + program scope (in-process),
 *   2. `QuickJSHost` registers the scope members as guest roots,
 *   3. `run(source)` lints, then evaluates the program in the sandbox — its
 *      top level IS the authoring pass; every `M.*` / `lesson.*` call bridges
 *      back to the real scope, so the host-side lesson/timeline is fully built
 *      when it returns,
 *   4. the caller plays that lesson with the ordinary host-side player.
 *
 * Guest closures (`partition.by`, `transition`, `apply`, `judge`, `cascade`
 * bodies) are retained by the bridge and re-invoked live — during the
 * authoring pass and, for interaction-time work, through `frame()`.
 *
 * This class is environment-agnostic: it takes an already-created
 * `QuickJSContext` (Node factory in `node.ts`; the browser builds one from the
 * single-file wasm variant), so no runtime-specific module is bundled where it
 * is not wanted.
 */

import type { QuickJSContext } from 'quickjs-emscripten-core';
import { Bridge } from './bridge.js';
import type { BridgeHooks } from './bridge.js';
import { FrameBudget, degradeFrame } from './budget.js';
import type { BudgetOpts, FrameResult } from './budget.js';
import { lint } from './lint.js';
import type { LintResult } from './lint.js';
import { GUEST_PRELUDE } from './prelude.js';
import { GuestError } from './protocol.js';
import { describeGuestError } from './guest-error.js';

export interface HostOpts {
  readonly budget?: BudgetOpts;
  readonly hooks?: BridgeHooks;
  /** Reject a program whose lint fails before it executes (default true). */
  readonly lintGate?: boolean;
}

export class LintError extends Error {
  constructor(readonly result: LintResult) {
    super(
      'lint failed: ' +
        result.findings
          .filter((f) => f.severity === 'error')
          .map((f) => `${f.rule}: ${f.message}`)
          .join('; '),
    );
    this.name = 'LintError';
  }
}

export class QuickJSHost {
  readonly bridge: Bridge;
  readonly budget: FrameBudget;
  private readonly roots: Record<string, string> = {};
  private booted = false;

  constructor(
    private readonly ctx: QuickJSContext,
    private readonly opts: HostOpts = {},
  ) {
    this.bridge = new Bridge(ctx, opts.hooks);
    this.budget = new FrameBudget(opts.budget);
  }

  /** Bind a host object as a guest global (the scope members, plus test hooks). */
  defineGlobal(name: string, obj: object): void {
    if (this.booted) throw new Error('defineGlobal must be called before run()');
    this.roots[name] = this.bridge.register(obj);
  }

  /** Bind every member of the program scope as a guest global. */
  defineScope(scope: Record<string, unknown>): void {
    for (const name of [
      'M',
      'Prob',
      'Calc',
      'LinAlg',
      'Graph',
      'Field',
      'View',
      'Layout',
      'Interaction',
      'F',
      'lesson',
    ] as const) {
      const member = scope[name];
      if (member && typeof member === 'object') this.defineGlobal(name, member as object);
    }
  }

  private boot(): void {
    if (this.booted) return;
    this.budget.install(this.ctx.runtime);
    this.bridge.install();
    // scope roots for the prelude to turn into guest globals
    const rootsHandle = this.ctx.newString(JSON.stringify(this.roots));
    this.ctx.setProp(this.ctx.global, '__ROOTS', rootsHandle);
    rootsHandle.dispose();
    this.evalOrThrow(GUEST_PRELUDE, '<prelude>', this.opts.budget?.authorMs ?? this.budget.authorMs);
    this.bridge.bindGuestEntry();
    this.booted = true;
  }

  /**
   * Lint, then execute a lesson program in the sandbox (the authoring pass).
   * Throws `LintError` (fail-fast) if the static gate rejects it, or
   * `GuestError` if the authoring pass itself throws / exhausts its budget.
   *
   * The lint gate targets the LLM-*authored* program. When the executable is a
   * bundle wrapped in the runtime shim (which legitimately reads the injected
   * scope globals), pass the raw author source as `opts.lintSource`; the
   * executable still runs, but the honest artifact-level gate scores the code
   * the model actually wrote.
   *
   * `opts.expectedBeats` is the plan's beat count, forwarded to the linter's
   * `beats-required` rule. Omit it when no plan stands behind the source (the
   * spikes, the verify harness) — the rule then does not fire.
   */
  run(
    source: string,
    opts: { readonly lintSource?: string; readonly expectedBeats?: number } = {},
  ): LintResult {
    const result = lint(opts.lintSource ?? source, {
      ...(opts.expectedBeats === undefined ? {} : { expectedBeats: opts.expectedBeats }),
    });
    if ((this.opts.lintGate ?? true) && !result.ok) throw new LintError(result);
    this.boot();
    // The bridge keeps this so a guest closure that throws at interaction time
    // — long after this call returns — can still quote the line that threw.
    this.bridge.programSource = source;
    this.evalOrThrow(source, '<program>', this.budget.authorMs);
    return result;
  }

  /**
   * Run one interaction-time frame: invoke a retained guest computation under
   * the per-frame budget, degrading (freeze / clamp) instead of failing. This
   * is how a guest closure that sits on the drag path survives a pathological
   * frame without tearing the program down.
   */
  frame<T>(
    compute: () => T,
    last: T,
    opts?: { readonly frameMs?: number; readonly accept?: (v: T) => boolean },
  ): FrameResult<T> {
    return degradeFrame(this.budget, last, compute, opts);
  }

  /**
   * Evaluate a guest expression and return its JSON-dumped value. For tests
   * and introspection only — not part of the program surface.
   */
  evalJSON<T = unknown>(expr: string): T {
    this.boot();
    this.budget.begin(this.budget.authorMs);
    let result;
    try {
      result = this.ctx.evalCode(`JSON.stringify(${expr})`, '<probe>');
    } finally {
      this.budget.end();
    }
    if (result.error) {
      const dumped = this.ctx.dump(result.error) as unknown;
      result.error.dispose();
      // No `source` here: the evaluated string is a one-line
      // `JSON.stringify(...)` wrapper, so quoting a line off `expr` would point
      // at the wrong thing. Name and frame still come through.
      throw new GuestError(describeGuestError(dumped).message);
    }
    const json = this.ctx.getString(result.value);
    result.value.dispose();
    return JSON.parse(json) as T;
  }

  dispose(): void {
    this.bridge.dispose();
    this.ctx.dispose();
  }

  private evalOrThrow(code: string, filename: string, ms: number): void {
    this.budget.begin(ms);
    let result;
    try {
      result = this.ctx.evalCode(code, filename);
    } finally {
      this.budget.end();
    }
    if (result.error) {
      const dumped = this.ctx.dump(result.error) as unknown;
      result.error.dispose();
      const { message, rawMessage, guestStack, site } = describeGuestError(dumped, {
        source: code,
        filename,
      });
      // `rawMessage`, not `message`: the enriched one quotes a line of the
      // program, and a lesson that merely mentions "interrupt" must not be
      // misreported as a frame-budget interrupt.
      throw new GuestError(message, /interrupt/i.test(rawMessage), { guestStack, site });
    }
    result.value.dispose();
  }
}
