/**
 * plan.ts — `AnswerPlan`, the surviving steering artifact (architecture
 * decision #11: "keep the plan pass, swap the step payload").
 *
 * What milestone 7 changed. The old plan chose a SPACE ("2d" | "3d") and a
 * COMPOSITION strategy, and its `steps[]` each became a separate declarative
 * scene — separate worlds, so a step could only "inherit" from an earlier one
 * by re-stating its param names in a prompt (`carries`).
 *
 * A lesson program has a timeline. The beats of an explanation are the
 * timeline's own steps, in ONE program against ONE world — so identity,
 * correspondence, and carried objects are native rather than re-established
 * by prose. `steps[]` is therefore no longer a generation unit; it is the
 * BEAT OUTLINE handed to a single program generation, and `carries` is gone
 * because it has nothing left to mean.
 *
 * `space` is gone too: a program is not typed by its dimensionality.
 * `visualize: false` replaces the old `space: "none"`.
 */

import { z } from 'zod/v4';

/**
 * The discipline libraries that exist in the program scope. Selecting a subset
 * keeps the generation prompt small: the kernel (lesson verbs, `M`, `F`,
 * `View`, `Layout`, `Interaction`) is always injected, discipline sections only
 * on request.
 *
 * An empty array is a legitimate, load-bearing answer — it means "no library
 * fits, compose from the kernel", which is exactly the two-tier vocabulary's
 * promise (architecture decision #4). Do not add a discipline here without a
 * library behind it — where "library" includes another pack's primitives with
 * a worked example on top: `abstract-algebra` ships no pack of its own, it is
 * the automata kernel plus the dihedral example (docs/probe-algebra.md), and
 * what the key actually selects is the example (see prompts.ts).
 */
export const DISCIPLINES = [
  'automata',
  'probability',
  'calculus',
  'linear-algebra',
  'abstract-algebra',
  'graphs',
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const BeatSchema = z
  .object({
    /**
     * ON-SCREEN TEXT. The student pages through the explanation beat by beat,
     * and this is what they read while parked at that boundary — so it is a
     * line of the explanation, not an outline label: short, concrete, in the
     * voice of the explanation itself ("Shrink Δx to nothing", not "Setup:
     * introduce the limit").
     */
    title: z.string().min(1),
    /** the single idea this beat should make visible — private steering for the program pass, never displayed */
    claim: z.string().min(1),
  })
  .strict();

export const AnswerPlanSchema = z
  .object({
    topic: z.string().min(1),
    /** the written answer: the statement + the essence of why it holds */
    summary: z.string().min(1),
    /**
     * False when prose alone answers it (the old `space: "none"`): no program
     * is generated and `summary` is the whole answer.
     */
    visualize: z.boolean().default(true),
    /** which library sections the program prompt should carry (may be empty) */
    disciplines: z.array(z.enum(DISCIPLINES)).default([]),
    /**
     * The beat outline for the ONE program that answers this question. The
     * prompt asks for 3-7; the floor is one notch lower so a legitimately short
     * answer does not hard-fail the parse.
     */
    beats: z.array(BeatSchema).min(2).max(7),
  })
  .strict();

export type Beat = z.infer<typeof BeatSchema>;
export type AnswerPlan = z.infer<typeof AnswerPlanSchema>;

export type PlanValidation =
  | { ok: true; plan: AnswerPlan }
  | { ok: false; errors: string[] };

export function validateAnswerPlan(input: unknown): PlanValidation {
  const parsed = AnswerPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, plan: parsed.data };
}
