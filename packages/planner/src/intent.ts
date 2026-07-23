/**
 * intent.ts — classify a follow-up BEFORE generating anything (roadmap 4b).
 *
 * Not every conversational turn is a generation. "set a = 0" is a `set-input`
 * event: no billed call, no gate, no latency, and it lands in the log as the
 * student's own act rather than as something the model wrote. Sending it to a
 * model to have a program fragment written for it would be slower, more
 * expensive, and less faithful to what happened.
 *
 * So the classifier's real job is the MANIPULATE case, and it does that
 * locally and conservatively. Everything else falls through to the model,
 * which is the safe direction: mistaking a question for a command would
 * silently move the student's scene, while mistaking a command for a question
 * costs one ordinary turn.
 *
 * The five intents are the roadmap's:
 *
 *  - `manipulate` — set a named quantity to a value. Answered with an EVENT.
 *  - `explain`    — a question about the scene. Answered read-only (step 4a).
 *  - `extend`     — add to the explanation. Needs a fragment.
 *  - `revise`     — change part of it. Needs a fragment, plus retire/replace.
 *  - `explore`    — open-ended. Treated as extend until evidence separates them.
 *
 * Only `manipulate` is decided here. The rest are named so the call sites can
 * route them, and so the day one of them needs its own handling there is
 * somewhere for it to go — but nothing pretends to classify them locally,
 * because a regex cannot tell `extend` from `explore` and guessing would put
 * the wrong prompt in front of the model.
 */

export type FollowupIntent = 'manipulate' | 'explain' | 'extend' | 'revise' | 'explore';

/** What the scene offers: the draggables, as the manifest reported them. */
export interface ManipulableTarget {
  readonly id: string;
  readonly label?: string;
  readonly range?: readonly [number, number];
}

export interface ManipulateIntent {
  readonly intent: 'manipulate';
  readonly target: ManipulableTarget;
  readonly value: number;
  /** Clamped into the target's range, if it had one — the same policy a drag obeys. */
  readonly clamped: boolean;
}

export interface UnclassifiedIntent {
  /** `null` when the local pass declined to decide — the model routes it. */
  readonly intent: null;
}

export type IntentResult = ManipulateIntent | UnclassifiedIntent;

/**
 * The shapes a "set it to n" actually arrives in. Deliberately few: each
 * pattern here is a place a question could be misread as a command, so the
 * bar for adding one is a real conversation that used it.
 */
const PATTERNS: readonly RegExp[] = [
  /^\s*set\s+(?<name>.+?)\s+(?:to|=)\s*(?<value>-?\d+(?:\.\d+)?)\s*\.?\s*$/i,
  /^\s*(?:make|put)\s+(?<name>.+?)\s+(?:to|=|equal to)\s*(?<value>-?\d+(?:\.\d+)?)\s*\.?\s*$/i,
  /^\s*(?<name>[^\s=]+)\s*=\s*(?<value>-?\d+(?:\.\d+)?)\s*\.?\s*$/,
];

/** Strip LaTeX noise so `\theta` and `$k$` match a plainly-typed name. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[$\\{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the one target a name refers to.
 *
 * AMBIGUITY IS A REFUSAL. If two draggables could answer to the name, this
 * returns nothing and the turn goes to the model — moving the wrong quantity
 * because two were plausibly named is a worse outcome than one extra call.
 */
function resolveTarget(
  name: string,
  targets: readonly ManipulableTarget[],
): ManipulableTarget | null {
  const wanted = normalize(name);
  if (wanted === '') return null;
  const exact = targets.filter((t) => normalize(t.label ?? t.id) === wanted || t.id === name);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const partial = targets.filter((t) => normalize(t.label ?? '').includes(wanted));
  return partial.length === 1 ? partial[0]! : null;
}

/**
 * Classify a follow-up against the scene's draggables.
 *
 * Returns `{ intent: null }` for everything it is not sure about — the caller
 * then sends the turn to the model. That default is the whole safety argument:
 * a local classifier that guesses wrong on a question would mutate a scene
 * nobody asked it to touch.
 */
export function classifyFollowup(
  question: string,
  targets: readonly ManipulableTarget[],
): IntentResult {
  for (const pattern of PATTERNS) {
    const m = pattern.exec(question);
    const name = m?.groups?.['name'];
    const raw = m?.groups?.['value'];
    if (!name || raw === undefined) continue;
    const target = resolveTarget(name, targets);
    if (!target) continue;
    const asked = Number(raw);
    if (!Number.isFinite(asked)) continue;
    const value = target.range
      ? Math.min(target.range[1], Math.max(target.range[0], asked))
      : asked;
    return { intent: 'manipulate', target, value, clamped: value !== asked };
  }
  return { intent: null };
}
