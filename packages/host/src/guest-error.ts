/**
 * guest-error.ts — turn a dumped QuickJS exception into something a repair
 * pass can act on.
 *
 * The library's own guards already produce good failures — *"partition
 * partition#1 has no class labeled 'hole 0' — available: Hole 0, Hole 1, Hole
 * 2"* names the object, the bad value and the valid alternatives. A raw engine
 * `TypeError` does not: the live gate's `derivative` program died as bare
 * **"not a function"**, with no identifier and no line, and a repair pass given
 * that can only guess which of 81 lines to re-examine.
 *
 * That was never the engine withholding information. QuickJS dumps
 *
 *   { name: "TypeError",
 *     message: "not a function",
 *     stack: "    at buildTheThing (<program>:2:3)\n    at <eval> (<program>:5:14)\n" }
 *
 * and both call sites kept `.message` alone, dropping the name and the whole
 * stack one line above where they were needed. `keepNames: true` in
 * `compileProgram` was already set precisely so those frames stay readable.
 *
 * Unlike the `readout` guard — which only works because someone anticipated
 * that specific trap — this is general: it improves every unnamed engine error,
 * including the ones nobody has hit yet.
 *
 * **Line numbers are honest here because we quote the code that actually ran.**
 * The guest executes the esbuild output, not the authored TypeScript, so the
 * stack's line numbers index the compiled JS. Rather than assume a mapping back
 * to the `.ts` (type-stripping usually preserves lines, but "usually" is not a
 * contract), the offending line is quoted verbatim from the same string that
 * was evaluated. The quote is always exact, and since the JS is type-stripped
 * TypeScript, the model recognises its own line.
 */

/** The innermost guest frame, when the stack named one. */
export interface GuestSite {
  /** enclosing function, e.g. `buildTheThing`; `<eval>` at the top level */
  readonly fn: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** the source line itself, trimmed — present only when the source was known */
  readonly text?: string;
}

export interface GuestErrorDetail {
  /** the enriched, repair-facing message */
  readonly message: string;
  /**
   * The engine's own message, unadorned.
   *
   * Load-bearing, not a convenience: callers classify errors by matching on the
   * message (`/interrupt/i` distinguishes a frame-budget interrupt from a
   * program bug), and the enriched message now quotes a line of the program.
   * Matching against that would let a lesson that merely mentions "interrupt"
   * in its source be reported as an interrupted frame.
   */
  readonly rawMessage: string;
  /** the guest-side stack, verbatim; `undefined` when the engine gave none */
  readonly guestStack?: string;
  readonly site?: GuestSite;
}

/** `    at buildTheThing (<program>:2:3)` */
const FRAME = /^\s*at\s+(.*?)\s*\(([^()]*):(\d+):(\d+)\)\s*$/;

/** Longest source line we will inline before truncating. */
const MAX_QUOTE = 160;

/**
 * Pick the frame to blame.
 *
 * The innermost frame is usually right, but not when the throw happens inside
 * `<prelude>` or another injected file: the program's own frame is what the
 * model can act on, so prefer the innermost frame belonging to `filename` and
 * fall back to the innermost frame of any kind.
 */
function parseSite(stack: string, filename?: string): Omit<GuestSite, 'text'> | undefined {
  const frames: Omit<GuestSite, 'text'>[] = [];
  for (const raw of stack.split('\n')) {
    const m = FRAME.exec(raw);
    if (!m) continue;
    frames.push({ fn: m[1] || '<anonymous>', file: m[2]!, line: Number(m[3]), column: Number(m[4]) });
  }
  if (frames.length === 0) return undefined;
  return (filename && frames.find((f) => f.file === filename)) || frames[0];
}

function quoteLine(source: string, line: number): string | undefined {
  const text = source.split('\n')[line - 1]?.trim();
  if (!text) return undefined;
  return text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1)}…` : text;
}

/**
 * Describe a dumped guest exception.
 *
 * Deliberately total: a dump with no stack, no message, or that is not even an
 * object still yields a usable `message`. An error path that can itself throw
 * is worse than the vague message it was meant to replace.
 */
export function describeGuestError(
  dumped: unknown,
  opts: { readonly source?: string; readonly filename?: string } = {},
): GuestErrorDetail {
  if (typeof dumped !== 'object' || dumped === null) {
    return { message: String(dumped), rawMessage: String(dumped) };
  }
  const rec = dumped as Record<string, unknown>;
  const rawMessage = 'message' in rec ? String(rec.message) : String(dumped);
  const name = typeof rec.name === 'string' ? rec.name : undefined;
  const stack = typeof rec.stack === 'string' ? rec.stack : undefined;

  // `TypeError: not a function` beats `not a function` — the class of failure is
  // itself a repair signal. Skip it when the message already leads with it, and
  // for `Error`, which adds nothing.
  const withName =
    name && name !== 'Error' && !rawMessage.startsWith(name) ? `${name}: ${rawMessage}` : rawMessage;

  if (!stack) return { message: withName, rawMessage };

  const found = parseSite(stack, opts.filename);
  if (!found) return { message: withName, rawMessage, guestStack: stack };

  const text = opts.source ? quoteLine(opts.source, found.line) : undefined;
  const site: GuestSite = text === undefined ? found : { ...found, text };

  // One line, densely: what broke, where, and the code that did it.
  const where = `at ${site.fn} (line ${site.line})`;
  const message = text ? `${withName} — ${where}: \`${text}\`` : `${withName} — ${where}`;
  return { message, rawMessage, guestStack: stack, site };
}
