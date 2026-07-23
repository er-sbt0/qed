/**
 * compile.ts — the generation-time gate that replaces the Zod scene validator.
 *
 * The old pipeline validated a DATA artifact: parse JSON, Zod-check it, and the
 * scene was either well-formed or it wasn't. A program cannot be validated that
 * way — so the gate is now three cheap, honest layers, in order:
 *
 *   1. EXTRACT   — pull the program out of the model's fenced code block.
 *   2. SHAPE     — planner-level rules about what a lesson program IS: no
 *                  imports/exports (the scope arrives as ambient globals), and
 *                  it must actually author something.
 *   3. TRANSFORM — esbuild strips the type annotations. This is also the real
 *                  SYNTAX gate: a program that does not parse fails here with a
 *                  line/column, which is a good repair signal.
 *   4. LINT      — `@math-ai/host`'s static gate (sandbox escapes, nondeterminism,
 *                  obviously unbounded loops), scored against the AUTHORED
 *                  TypeScript, not the stripped output.
 *
 * What this deliberately does NOT do is typecheck against the library's
 * declarations. Every layer here costs milliseconds and needs no toolchain; a
 * real `tsc` pass would be the strongest possible signal but wants a temp
 * project per generation. The layer below (execution, in the browser) reports
 * runtime diagnostics instead — which is where the determinant spike's only bug
 * was catchable anyway: it declared a formula span role it never minted, and
 * `span(role: string)` accepts any string, so no type system would have caught
 * it either.
 */

import { transform } from 'esbuild';
import { lint } from '@math-ai/host';
import type { LintFinding, LintResult } from '@math-ai/host';

export interface CompiledProgram {
  /** the TypeScript the model authored (the artifact of record) */
  readonly source: string;
  /** type-stripped ES2020, ready for `QuickJSHost.run` */
  readonly js: string;
  /** lint findings against `source`; warnings do not fail the gate */
  readonly findings: readonly LintFinding[];
}

export type CompileResult =
  | { ok: true; program: CompiledProgram }
  | { ok: false; stage: 'extract' | 'shape' | 'syntax' | 'lint'; errors: string[] };

/**
 * Pull the lesson program out of a model response. The program pass answers in
 * markdown with exactly one fenced block, because asking for a 200-line
 * TypeScript program inside a JSON string means every quote, backslash, and
 * newline is escaped — and `F.tex` templates are made of backslashes.
 *
 * Falls back to the whole response when it is unfenced but looks like code.
 */
export function extractProgram(raw: string): string | null {
  const fence = /```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fence.exec(raw)) !== null) blocks.push(m[1]!);
  if (blocks.length > 0) {
    // The longest block is the program; shorter ones are commentary snippets.
    return blocks.reduce((a, b) => (b.length > a.length ? b : a)).trim() || null;
  }
  const trimmed = raw.trim();
  return /\blesson\s*\.|\bView\s*\.|\bM\s*\./.test(trimmed) ? trimmed : null;
}

/**
 * Program-shape rules. These are a PLANNER concern, not a sandbox concern, so
 * they live here rather than in the host linter: the host's job is "can this
 * escape or hang", ours is "is this the kind of thing our runner can run".
 */
function shapeErrors(source: string): string[] {
  const errors: string[] = [];
  if (/^\s*import\s+[^(]/m.test(source) || /^\s*export\s+/m.test(source)) {
    errors.push(
      'a lesson program must not import or export anything — the scope ' +
        '(lesson, M, F, View, Layout, Calc, LinAlg, Prob, Graph, Interaction) is already ' +
        'in scope as ambient globals. Delete the import/export statements.',
    );
  }
  if (!/\blesson\s*\./.test(source)) {
    errors.push(
      'the program never calls a `lesson.*` verb, so it authors no timeline and ' +
        'nothing would play. Author the beats with lesson.say/show/focus/...',
    );
  }
  return errors;
}

/** Format esbuild's structured errors into repair-ready lines. */
function syntaxErrors(err: unknown): string[] {
  const e = err as { errors?: Array<{ text: string; location?: { line: number; column: number } }> };
  if (!e?.errors?.length) return [(err as Error).message ?? String(err)];
  return e.errors.map((x) =>
    x.location ? `line ${x.location.line}:${x.location.column}: ${x.text}` : x.text,
  );
}

export interface CompileOpts {
  /**
   * How many beats the plan asked for, forwarded to the linter's
   * `beats-required` rule. Omit when there is no plan (the rule stays silent).
   */
  readonly expectedBeats?: number;
}

/**
 * Strip types and gate. `iife` matches the format the milestone-5/6 spike
 * bundles ran under, so a generated program reaches QuickJS the same way the
 * four proven programs do.
 */
export async function compileProgram(source: string, opts: CompileOpts = {}): Promise<CompileResult> {
  const shape = shapeErrors(source);
  if (shape.length > 0) return { ok: false, stage: 'shape', errors: shape };

  let js: string;
  try {
    const out = await transform(source, {
      loader: 'ts',
      format: 'iife',
      target: 'es2020',
      // Keep the authored names in stack traces — runtime diagnostics are the
      // repair signal for everything the static gate cannot see.
      keepNames: true,
    });
    js = out.code;
  } catch (err) {
    return { ok: false, stage: 'syntax', errors: syntaxErrors(err) };
  }

  const result: LintResult = lint(source, {
    ...(opts.expectedBeats === undefined ? {} : { expectedBeats: opts.expectedBeats }),
  });
  if (!result.ok) {
    return {
      ok: false,
      stage: 'lint',
      errors: result.findings
        .filter((f) => f.severity === 'error')
        .map((f) => `${f.rule}: ${f.message}`),
    };
  }
  return { ok: true, program: { source, js, findings: result.findings } };
}

/**
 * Gate a conversational FRAGMENT (roadmap 4b).
 *
 * The same gate, minus one rule. `beats-required` counts `lesson.beat` calls
 * against a plan's beat count, and a fragment has no plan behind it — it is
 * one turn's addition to an explanation that already exists. Passing no
 * `expectedBeats` silences the rule, which is exactly what it was built to do
 * for hand-written sources.
 *
 * Everything else applies unchanged, and deliberately: a fragment runs in the
 * same sandbox with the same determinism requirement, and determinism is what
 * makes `state = fold(log)` true. A fragment that reached for Math.random
 * would make its own conversation unreplayable.
 */
export async function compileFragment(source: string): Promise<CompileResult> {
  return compileProgram(source);
}

/** Extract + compile a fragment out of a raw model response. */
export async function compileFragmentResponse(raw: string): Promise<CompileResult> {
  return compileResponse(raw);
}

/** Extract + compile in one step, for a raw model response. */
export async function compileResponse(raw: string, opts: CompileOpts = {}): Promise<CompileResult> {
  const source = extractProgram(raw);
  if (source === null) {
    return {
      ok: false,
      stage: 'extract',
      errors: ['the response contained no TypeScript code block'],
    };
  }
  return compileProgram(source, opts);
}
