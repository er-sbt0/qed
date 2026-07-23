/**
 * generate.ts — the two-pass pipeline, milestone 7's replacement for the
 * declarative harness.
 *
 *   PASS 1  plan     — recall the result, decide how to explain it (kept).
 *   PASS 2  program  — write ONE lesson program for the whole answer (new).
 *   GATE             — extract, shape, syntax, lint (replaces the Zod gate).
 *   REPAIR           — one round-trip, because the gates produce messages a
 *                      model can act on. This is the discover-and-repair loop
 *                      an open vocabulary needs, not a retry-until-lucky loop:
 *                      it runs ONCE and then gives up honestly.
 *
 * Runtime failures are not visible from here — the program executes in the
 * browser's sandbox, after this function has returned. `repairProgram` is
 * exported for the client to call back with a runtime diagnostic, which is the
 * other half of "static lint + runtime diagnostics replace the Zod gate".
 */

import { AnswerPlanSchema, type AnswerPlan, type Discipline } from './plan.js';
import { compileFragmentResponse, compileResponse, type CompiledProgram } from './compile.js';
import {
  FOLLOWUP_SYSTEM,
  PLAN_SYSTEM,
  followupBrief,
  fragmentBrief,
  fragmentSystem,
  programBrief,
  programSystem,
  repairBrief,
} from './prompts.js';
import { completeJSON, type ModelClient, type ModelTurn } from './model.js';

export interface GenerateOpts {
  /** allow one repair round-trip on a failed gate (default true) */
  readonly repair?: boolean;
}

export interface AnswerResult {
  readonly plan: AnswerPlan;
  /** the prose answer — always present, even when nothing is visualized */
  readonly explanation: string;
  /** null when the plan chose not to visualize, or when the gate rejected both attempts */
  readonly program: CompiledProgram | null;
  /** why there is no program, when there isn't one */
  readonly failure?: { readonly stage: string; readonly errors: readonly string[] };
  /** how many program generations it took (1, or 2 with a repair) */
  readonly attempts: number;
}

export async function planAnswer(client: ModelClient, question: string): Promise<AnswerPlan> {
  return completeJSON(client, AnswerPlanSchema, {
    system: PLAN_SYSTEM,
    messages: [{ role: 'user', content: question }],
  });
}

/**
 * Generate a program for a plan, gate it, and repair once if the gate rejects
 * it. The conversation is carried across the repair turn so the model sees its
 * own program rather than a description of it.
 */
export async function generateProgram(
  client: ModelClient,
  question: string,
  plan: AnswerPlan,
  opts: GenerateOpts = {},
): Promise<{
  program: CompiledProgram | null;
  failure?: { stage: string; errors: readonly string[] };
  attempts: number;
}> {
  const system = programSystem(plan.disciplines);
  const messages: ModelTurn[] = [{ role: 'user', content: programBrief(question, plan) }];

  for (let attempt = 1; ; attempt++) {
    const raw = await client.complete({ system, messages });
    const result = await compileResponse(raw, { expectedBeats: plan.beats.length });
    if (result.ok) return { program: result.program, attempts: attempt };

    const lastAttempt = attempt >= (opts.repair === false ? 1 : 2);
    if (lastAttempt) {
      return {
        program: null,
        failure: { stage: result.stage, errors: result.errors },
        attempts: attempt,
      };
    }
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: repairBrief(result.errors, 'gate') });
  }
}

/** Plan, then write and gate the program. */
export async function generateAnswer(
  client: ModelClient,
  question: string,
  opts: GenerateOpts = {},
): Promise<AnswerResult> {
  const plan = await planAnswer(client, question);
  if (!plan.visualize) {
    return { plan, explanation: plan.summary, program: null, attempts: 0 };
  }
  const { program, failure, attempts } = await generateProgram(client, question, plan, opts);
  return {
    plan,
    explanation: plan.summary,
    program,
    ...(failure ? { failure } : {}),
    attempts,
  };
}

/**
 * Repair a program that passed the static gate but failed at RUNTIME — the
 * failure mode the architecture calls critical-path, and the one the
 * determinant spike actually hit (it linked a formula span role it never
 * declared; `span(role: string)` accepts any string, so only execution could
 * catch it). The browser calls this with the diagnostic it saw.
 */
export async function repairProgram(
  client: ModelClient,
  question: string,
  plan: AnswerPlan,
  source: string,
  errors: readonly string[],
): Promise<{ program: CompiledProgram | null; failure?: { stage: string; errors: readonly string[] } }> {
  const raw = await client.complete({
    system: programSystem(plan.disciplines),
    messages: [
      { role: 'user', content: programBrief(question, plan) },
      { role: 'assistant', content: '```ts\n' + source + '\n```' },
      { role: 'user', content: repairBrief(errors, 'runtime') },
    ],
  });
  const result = await compileResponse(raw, { expectedBeats: plan.beats.length });
  return result.ok
    ? { program: result.program }
    : { program: null, failure: { stage: result.stage, errors: result.errors } };
}

/**
 * Answer a follow-up question about a scene that is already on screen
 * (roadmap step 4a). READ-ONLY: it returns prose and nothing else.
 *
 * The manifest can only be built in the browser — it is a live read of the
 * host-side world, so the client posts it up exactly as it already posts
 * runtime `errors[]` to `repairProgram`. That keeps this function stateless
 * like every other pass here, and keeps a conversation replayable from its
 * inputs rather than from a long-lived session.
 */
export async function answerFollowup(
  client: ModelClient,
  manifest: unknown,
  question: string,
  opts: { readonly originalQuestion?: string } = {},
): Promise<string> {
  const raw = await client.complete({
    system: FOLLOWUP_SYSTEM,
    messages: [{ role: 'user', content: followupBrief(manifest, question, opts.originalQuestion) }],
    maxTokens: 1024,
  });
  return raw.trim();
}

/**
 * Write and gate ONE conversational fragment (roadmap step 4b).
 *
 * Same repair round-trip as the program pass, and for the same reason: the
 * gate's messages are actionable, so handing one back is cheaper than a retry.
 * What it does NOT do is decide whether to generate at all — `classifyFollowup`
 * answers a "set a = 0" with an event and never reaches here, which is the
 * point of classifying first.
 */
export async function generateFragment(
  client: ModelClient,
  manifest: unknown,
  question: string,
  opts: GenerateOpts & { readonly disciplines?: readonly Discipline[]; readonly originalQuestion?: string } = {},
): Promise<{
  fragment: CompiledProgram | null;
  failure?: { stage: string; errors: readonly string[] };
  attempts: number;
}> {
  const system = fragmentSystem(opts.disciplines ?? []);
  const messages: ModelTurn[] = [
    { role: 'user', content: fragmentBrief(manifest, question, opts.originalQuestion) },
  ];

  for (let attempt = 1; ; attempt++) {
    const raw = await client.complete({ system, messages });
    const result = await compileFragmentResponse(raw);
    if (result.ok) return { fragment: result.program, attempts: attempt };

    if (attempt >= (opts.repair === false ? 1 : 2)) {
      return { fragment: null, failure: { stage: result.stage, errors: result.errors }, attempts: attempt };
    }
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: repairBrief(result.errors, 'gate') });
  }
}
