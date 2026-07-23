/**
 * lint.ts — the static gate at generation time. This is the ONE place
 * fail-fast still applies (architecture: "Static lint at generation … Lint
 * failure fails the artifact"): a program that cannot possibly be sound is
 * rejected BEFORE it executes, so a doomed artifact never renders.
 *
 * Honest scope — what it catches:
 *   1. parse / syntax errors (via esbuild-free, dependency-free scanning of
 *      balanced structure is not enough, so callers may also pre-parse; here
 *      we do a lexical pass);
 *   2. sandbox-escape / nondeterminism globals — `eval`, `Function`, `require`,
 *      `import(`, `fetch`, `process`, `WebAssembly`, `XMLHttpRequest`, timers
 *      (errors); `Date`, `Math.random` (warnings — they break "the program is
 *      the artifact" determinism);
 *   3. obvious UNBOUNDED top-level loops — `while (true)`, `for (;;)`,
 *      `while (1)` whose body contains no `break` / `return` / `throw`;
 *   4. MISSING STEP BOUNDARIES — a program that does not declare the plan's
 *      beats with `lesson.beat(...)` (only when the caller supplies the plan's
 *      beat count; see `beats-required` below).
 *
 * What it deliberately can NOT catch (and why that is fine):
 *   - a loop that diverges only for some runtime input, or one hidden inside a
 *     closure re-invoked per frame — that is the INTERRUPT BUDGET's job, not
 *     the linter's (the two are complementary: lint kills the statically-doomed,
 *     the budget survives the dynamically-pathological);
 *   - arity / type mismatches against the scope surface — the LLM writes
 *     against typed sketches and the TS build catches these before we ever get
 *     a program string; a value-level check here would duplicate the type
 *     system badly;
 *   - semantic wrongness (a mislabelled verdict) — out of scope by decision #3.
 */

export interface LintFinding {
  readonly severity: 'error' | 'warning';
  readonly rule: string;
  readonly message: string;
}

export interface LintResult {
  readonly ok: boolean;
  readonly findings: readonly LintFinding[];
}

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beval\s*\(/, 'eval() is a sandbox-escape and nondeterminism surface'],
  [/\bnew\s+Function\b|\bFunction\s*\(/, 'Function() constructs code at runtime'],
  [/\brequire\s*\(/, 'require() is not available in the sandbox'],
  [/\bimport\s*\(/, 'dynamic import() is not available in the sandbox'],
  [/\bfetch\s*\(/, 'network access is forbidden in the sandbox'],
  [/\bXMLHttpRequest\b/, 'network access is forbidden in the sandbox'],
  [/\bWebAssembly\b/, 'WebAssembly is not reachable from a lesson program'],
  [/\bprocess\b/, 'process is a host-escape surface'],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'timers are not available; use the timeline verbs'],
  [/\bglobalThis\b|\bwindow\b|\bdocument\b/, 'the global object is not a lesson surface'],
];

const SUSPECT: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\b/, 'Date breaks determinism ("the program is the artifact")'],
  [/\bMath\s*\.\s*random\s*\(/, 'Math.random breaks determinism — seed a generator instead'],
];

/** Strip strings, template literals, and comments so scans ignore text. */
function stripCode(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    if (two === '//') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Find `while (true) { ... }` / `for (;;) { ... }` with no escape in the body. */
function unboundedLoops(code: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const re = /\b(while\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\))\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const open = re.lastIndex - 1;
    let depth = 0;
    let j = open;
    for (; j < code.length; j += 1) {
      if (code[j] === '{') depth += 1;
      else if (code[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = code.slice(open + 1, j);
    if (!/\b(break|return|throw)\b/.test(body)) {
      findings.push({
        severity: 'error',
        rule: 'unbounded-loop',
        message: `unbounded top-level loop \`${m[1]!.trim()}\` has no break/return/throw`,
      });
    }
  }
  return findings;
}

/** Cheap structural parse check: balanced brackets/quotes. */
function structuralErrors(src: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const code = stripCode(src);
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const ch of code) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== pairs[ch]) {
        findings.push({ severity: 'error', rule: 'parse', message: `unbalanced \`${ch}\`` });
        return findings;
      }
    }
  }
  if (stack.length > 0) {
    findings.push({ severity: 'error', rule: 'parse', message: `unclosed \`${stack[stack.length - 1]}\`` });
  }
  // an unterminated string/template shows up as leftover quote in raw source
  return findings;
}

/**
 * How far the authored beat count may drift from the plan's before we call it
 * a different explanation. ONE is deliberate: merging two adjacent beats, or
 * splitting one that turned out to need two moves, is an authoring judgement
 * the model is allowed to make and is not worth a repair round-trip. Anything
 * beyond that (half the beats missing, beats invented wholesale) means the
 * program is no longer the plan that was approved, and the student's step
 * controls would not match the outline — that IS worth failing the gate for.
 */
const BEAT_COUNT_TOLERANCE = 1;

/** Count `lesson.beat(...)` calls. `code` must already be string/comment-stripped. */
function countBeats(code: string): number {
  return (code.match(/\blesson\s*\.\s*beat\s*\(/g) ?? []).length;
}

/**
 * How many beats a program AUTHORS, read off its own source — comments and
 * strings excluded, which a plain regex over raw source gets wrong (a doc
 * comment that mentions `lesson.beat(...)` counts as a beat). Exported for
 * callers that have a program but no plan behind it, where the program is its
 * own outline: hand-written examples, and anything checking that every beat a
 * program writes survives the trip across the sandbox boundary.
 */
export function authoredBeatCount(source: string): number {
  return countBeats(stripCode(source));
}

/**
 * `beats-required` — the step boundaries the student pages through. Silent
 * unless the caller says how many beats the plan has: the acceptance programs
 * and any hand-written source are linted with no plan behind them, and a rule
 * that fired there would reject perfectly good programs.
 */
function beatFindings(code: string, expected: number | undefined): LintFinding[] {
  if (expected === undefined || expected <= 0) return [];
  const actual = countBeats(code);
  if (actual === 0) {
    return [
      {
        severity: 'error',
        rule: 'beats-required',
        message:
          `the plan has ${expected} beats but the program never calls lesson.beat() — ` +
          `open each beat with lesson.beat('<the plan beat title, verbatim>') as its FIRST statement, ` +
          `so the student can step through the explanation one beat at a time`,
      },
    ];
  }
  if (Math.abs(actual - expected) > BEAT_COUNT_TOLERANCE) {
    return [
      {
        severity: 'error',
        rule: 'beats-required',
        message:
          `the program calls lesson.beat() ${actual} time(s) but the plan has ${expected} beats — ` +
          `emit exactly one lesson.beat('<the plan beat title, verbatim>') per plan beat, in plan order, ` +
          `as the first statement of that beat`,
      },
    ];
  }
  return [];
}

export interface LintOptions {
  /**
   * How many beats the plan asked for. Omit when there is no plan behind the
   * source (hand-written programs, the acceptance spikes) — `beats-required`
   * then does not fire at all.
   */
  readonly expectedBeats?: number;
}

export function lint(source: string, opts: LintOptions = {}): LintResult {
  const findings: LintFinding[] = [];
  findings.push(...structuralErrors(source));
  const code = stripCode(source);
  for (const [re, message] of BANNED) {
    if (re.test(code)) findings.push({ severity: 'error', rule: 'banned-global', message });
  }
  for (const [re, message] of SUSPECT) {
    if (re.test(code)) findings.push({ severity: 'warning', rule: 'nondeterminism', message });
  }
  findings.push(...unboundedLoops(code));
  findings.push(...beatFindings(code, opts.expectedBeats));
  return { ok: !findings.some((f) => f.severity === 'error'), findings };
}
