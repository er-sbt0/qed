/**
 * conversation.ts — a lesson and a conversation as ONE artifact (roadmap 4b).
 *
 * The artifact is an **ordered log of authoring acts**: program fragments the
 * model wrote, and events the student's hands produced. Replaying the log from
 * scratch reproduces the scene exactly, which is what makes a whole
 * conversation a cassette — one billed chat session becomes a permanent free
 * regression test, exactly as `record` does for a single generation today.
 *
 * ## Why the ORDER is load-bearing, and not negotiable
 *
 * The tempting design is "replay all the fragments, then apply the student's
 * current values on top". It is wrong by construction. A turn-2 fragment may
 * be authored *against* a value the student had already dragged — the model
 * saw it in the scene manifest and wrote `M.claim` about it. Applying that
 * drag after turn 2 rather than before it hands the fragment a different world
 * than the one it was written for.
 *
 * So events are entries, interleaved, and replay walks the log in order.
 *
 * Continuous drags COALESCE: a student sweeping a slider produces thousands of
 * pokes, and none of them is an authoring act. One checkpoint event is written
 * when the student asks something, saves, or branches — the moments where the
 * value actually becomes part of the record.
 *
 * ## Why this needs no long-lived sandbox session
 *
 * Lesson programs are deterministic — the linter enforces it (no Date, no
 * Math.random, no I/O). So the world state IS the log: `state = fold(log)`.
 * A turn needs no server-side VM kept warm between requests, and a failed turn
 * costs nothing to undo.
 *
 * ## The transaction story, in one rule
 *
 * `commitEntry` folds the CANDIDATE log headlessly first. If the fold throws,
 * the entry is rejected and the previous log is returned untouched — the
 * student's scene never enters a broken state, and there is no partial apply
 * to unwind. That one rule is the whole transaction design at this step.
 *
 * ## Fragments must be INDEPENDENTLY SCOPED, and already are
 *
 * `QuickJSHost.run` evaluates in the guest's global scope, so two turns that
 * both write `const spin = …` collide with a bare `SyntaxError: redeclaration
 * of 'spin'` — a failure with nothing in it pointing at conversations. They do
 * not collide in the real pipeline, because `compileProgram` emits esbuild's
 * `format: 'iife'` and every turn arrives already wrapped in its own function
 * scope. `isolate()` below makes that requirement explicit rather than
 * incidental, and it is idempotent, so a fold may apply it to already-wrapped
 * output.
 *
 * The consequence is the one the design wanted anyway: a fragment cannot see
 * an earlier turn's bindings, so `M.byId` is the ONLY way to reach back. Ids
 * are not fragile here — the linter enforces determinism, so an unchanged
 * prefix mints identical ids on every fold.
 *
 * Everything here is pure: execution and id resolution arrive as hooks, so the
 * log logic is testable with no QuickJS and no browser.
 */

import type { Id } from '@math-ai/core';

// ─────────────────────────────── the log ───────────────────────────────

/** The turn-1 whole program. Exactly one of these, and it is always first. */
export interface ProgramEntry {
  readonly kind: 'program';
  readonly source: string;
  readonly js: string;
}

/** A later turn's appended program fragment. */
export interface FragmentEntry {
  readonly kind: 'fragment';
  readonly source: string;
  readonly js: string;
  /** Which conversational turn authored it — for reading a log, not for replay. */
  readonly turn?: number;
}

/**
 * A student's hands, as an authoring act.
 *
 * `set-input` is deliberately the only one so far. It is what a drag
 * checkpoint and a "set a = 0" request both reduce to, and adding event types
 * ahead of a conversation that needs them would be exactly the speculative
 * ontology this plan's method forbids.
 */
export interface SetInputEvent {
  readonly type: 'set-input';
  /** The handle id, as the scene manifest reported it. */
  readonly target: Id;
  readonly value: number;
}

export type StudentEvent = SetInputEvent;

export interface EventEntry {
  readonly kind: 'event';
  readonly event: StudentEvent;
  readonly turn?: number;
}

export type LogEntry = ProgramEntry | FragmentEntry | EventEntry;

export type ConversationLog = readonly LogEntry[];

/**
 * Wrap a turn in its own function scope, unless it plainly already is one.
 *
 * The check is deliberately syntactic and conservative: wrapping twice is
 * harmless, so a false negative costs nothing, while failing to wrap costs a
 * redeclaration error on the next turn that reuses a name.
 */
export function isolate(js: string): string {
  const trimmed = js.trim();
  if (/^\(\s*(\(\s*\)|function)/.test(trimmed) || trimmed.startsWith('(()=>')) return js;
  return `(() => {\n${js}\n})();`;
}

// ─────────────────────────────── replay ───────────────────────────────

/** What a `set-input` event needs of its target: the interaction-path setter. */
export interface Settable {
  setValueLive?(next: number): void;
  setValue?(next: number): void;
}

export interface ReplayHooks {
  /** Evaluate one program or fragment in the sandbox. Throws on failure. */
  readonly execute: (entry: ProgramEntry | FragmentEntry) => void;
  /** Resolve a handle id against the scene AS IT NOW STANDS mid-replay. */
  readonly resolve: (id: Id) => Settable | undefined;
}

export interface ReplayFailure {
  /** Position in the log — which act broke, not merely that something did. */
  readonly index: number;
  readonly kind: LogEntry['kind'];
  readonly message: string;
}

export type ReplayResult = { ok: true } | { ok: false; failure: ReplayFailure };

/**
 * Replay a log in order against a freshly built world.
 *
 * An event whose target no longer exists is a FAILURE, not a skip. It means
 * the log references something a fragment retired or never created, and
 * quietly dropping it would make the replayed scene differ from the recorded
 * one — which is precisely the property a conversation cassette exists to
 * check.
 */
export function replayLog(log: ConversationLog, hooks: ReplayHooks): ReplayResult {
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index]!;
    try {
      if (entry.kind === 'event') {
        applyEvent(entry.event, hooks.resolve);
      } else {
        hooks.execute(entry);
      }
    } catch (err) {
      return {
        ok: false,
        failure: {
          index,
          kind: entry.kind,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
  return { ok: true };
}

function applyEvent(event: StudentEvent, resolve: (id: Id) => Settable | undefined): void {
  const target = resolve(event.target);
  if (!target) {
    throw new Error(
      `set-input names "${event.target}", which is not in the scene at this point in the log. ` +
        `An event may only reference something that exists when it is replayed.`,
    );
  }
  // `setValueLive` is the interaction path: same clamp policy, no timeline
  // step. A drag checkpoint is not a beat of the explanation, and recording it
  // as one would grow the timeline the player walks.
  const apply = target.setValueLive ?? target.setValue;
  if (!apply) {
    throw new Error(
      `set-input names "${event.target}", which is not settable. Only exposed Parameters and ` +
        `matrix cells can receive one — the manifest marks those \`draggable\`.`,
    );
  }
  apply.call(target, event.value);
}

// ───────────────────────────── the transaction ─────────────────────────────

export type CommitResult =
  | { readonly ok: true; readonly log: ConversationLog }
  | { readonly ok: false; readonly log: ConversationLog; readonly errors: readonly string[] };

/**
 * Append an entry, but only if the resulting log still folds.
 *
 * `tryFold` is handed the CANDIDATE log and must replay it somewhere
 * disposable — a fresh headless world. On rejection the caller gets its
 * previous log back, unchanged and still on screen. Nothing is half-applied,
 * because nothing was applied to the live scene at all.
 */
export async function commitEntry(
  log: ConversationLog,
  entry: LogEntry,
  tryFold: (candidate: ConversationLog) => Promise<ReplayResult> | ReplayResult,
): Promise<CommitResult> {
  const candidate = [...log, entry];
  const result = await tryFold(candidate);
  if (result.ok) return { ok: true, log: candidate };
  return {
    ok: false,
    log,
    errors: [
      `the ${result.failure.kind} at position ${result.failure.index} broke the scene: ` +
        result.failure.message,
    ],
  };
}

// ────────────────────────────── reading a log ──────────────────────────────

/**
 * The whole conversation as one program, for a human or a repair brief.
 *
 * NOT what replay runs. Events cannot be expressed as source, so a
 * concatenation of the fragments alone is a lie about the scene the moment the
 * student has touched anything — which is why `replayLog` walks entries rather
 * than folding to a string. This is for reading.
 */
export function foldSource(log: ConversationLog): string {
  return log
    .map((e, i) =>
      e.kind === 'event'
        ? `// [${i}] student: set ${e.event.target} = ${e.event.value}`
        : `// [${i}] ${e.kind}\n${e.source.trim()}`,
    )
    .join('\n\n');
}

/** The events the student has produced, in order — the record of their hands. */
export function studentEvents(log: ConversationLog): readonly StudentEvent[] {
  return log.flatMap((e) => (e.kind === 'event' ? [e.event] : []));
}

/**
 * Collapse consecutive `set-input` events on the SAME target down to the last
 * one, which is what a drag actually meant.
 *
 * Only consecutive ones: a set, then a fragment, then another set on the same
 * target are two distinct acts, because the fragment in between may have been
 * authored against the first value. Merging across it would silently rewrite
 * the world that fragment was written for.
 */
export function coalesce(log: ConversationLog): ConversationLog {
  const out: LogEntry[] = [];
  for (const entry of log) {
    const prev = out[out.length - 1];
    if (
      entry.kind === 'event' &&
      prev?.kind === 'event' &&
      prev.event.target === entry.event.target
    ) {
      out[out.length - 1] = entry;
      continue;
    }
    out.push(entry);
  }
  return out;
}
