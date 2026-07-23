/**
 * protocol.ts — the wire vocabulary shared by the host bridge and the guest
 * prelude. Everything crossing the wasm boundary is a JSON string encoding a
 * tree of these nodes.
 *
 *   p   primitive (number | string | boolean | null)
 *   u   undefined
 *   r   opaque reference to a HOST object (guest sees a Proxy). `id`/`kind`
 *       ride along so the guest can answer `.id`/`.kind` without a round-trip.
 *   f   reference to a GUEST function the host retains and calls back
 *   m   method marker — the answer to `get` when the property is a function;
 *       the guest turns it into an invoke stub
 *   a   array (with optional `raw` ⇒ a TemplateStringsArray, load-bearing for
 *       `F.tex`, which reads `strings.raw`)
 *   o   plain object, value-copied (Verdict, opts, diagnostics)
 *   err a thrown error, surfaced as an exception on the other side
 */

import type { GuestSite } from './guest-error.js';

export type WireNode =
  | { readonly k: 'p'; readonly v: number | string | boolean | null }
  // non-finite numbers: JSON cannot carry Infinity/NaN, but a divide-by-zero
  // mid-drag MUST survive the boundary so the host can clamp it.
  | { readonly k: 'nf'; readonly v: 'inf' | '-inf' | 'nan' }
  | { readonly k: 'u' }
  | { readonly k: 'r'; readonly ref: string; readonly id?: string; readonly kind?: string }
  | { readonly k: 'f'; readonly ref: string }
  | { readonly k: 'm'; readonly ref: string; readonly key: string }
  | { readonly k: 'a'; readonly v: readonly WireNode[]; readonly raw?: readonly string[] }
  | { readonly k: 'o'; readonly v: Record<string, WireNode> }
  | { readonly k: 'err'; readonly msg: string; readonly v?: boolean };

/** Guest → host dispatch payloads (the `__host(json)` argument). */
export type HostCall =
  | { readonly op: 'get'; readonly ref: string; readonly key: string }
  | { readonly op: 'has'; readonly ref: string; readonly key: string }
  | { readonly op: 'invoke'; readonly ref: string; readonly key: string; readonly args: readonly WireNode[] };

/** Raised on the host when a guest callback throws or the frame budget fires. */
export class GuestError extends Error {
  /**
   * The GUEST stack, verbatim, when the engine gave one — not to be confused
   * with `.stack`, which is this host object's own and says only where in the
   * host the error was rethrown. See `guest-error.ts`.
   */
  readonly guestStack?: string;
  /** The innermost guest frame: function, line, and the code on it. */
  readonly site?: GuestSite;

  constructor(
    message: string,
    /** True when the guest was interrupted by the frame budget (not a program bug). */
    readonly interrupted = false,
    detail?: { readonly guestStack?: string; readonly site?: GuestSite },
  ) {
    super(message);
    this.name = 'GuestError';
    if (detail?.guestStack !== undefined) this.guestStack = detail.guestStack;
    if (detail?.site !== undefined) this.site = detail.site;
  }
}
