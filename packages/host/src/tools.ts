/**
 * tools.ts — the scene as an instrument (roadmap 4c).
 *
 * A conversational turn becomes a tool loop: the model holds typed tools, each
 * a thin RPC over machinery that already exists — `sceneIndex` for reach,
 * disposable folds (`commitEntry`'s transaction) for experiments, the reactive
 * graph for causality. Nothing here computes mathematics or grows a pipeline;
 * every tool resolves, reads, folds, or commits through seams built in 4a/4b.
 *
 * ## Errors are data
 *
 * In the eventual loop a tool error goes BACK TO THE MODEL as the tool result,
 * where it is the retry prompt (a gate rejection returned verbatim is the 4b
 * repair loop become ordinary tool-retry). So nothing in this module throws
 * across the boundary: every tool returns `ToolResult`, and `runTool` catches
 * what the scene itself throws (a derived that errors mid-read) into one too.
 *
 * ## The boundary is the manifest's
 *
 * Every id resolves against the injected scene map, which callers MUST build
 * with `sceneIndex(stage)` — exactly what the manifest offered the model,
 * nothing else. An object the student was never shown is unreachable; a
 * retired one stays retired. The hook is the same seam `ReplayHooks.resolve`
 * already is, and for the same reason: this module stays pure and
 * browser-free, while the render package keeps sole ownership of what "in the
 * scene" means. Do not back the hook with any other registry.
 */

import type { Handle, Id } from '@math-ai/core';
import { commitEntry } from './conversation.js';
import type {
  ConversationLog,
  EventEntry,
  FragmentEntry,
  ReplayFailure,
  ReplayResult,
} from './conversation.js';

// ─────────────────────────── the call/result surface ───────────────────────────

export type Json =
  | null
  | number
  | string
  | boolean
  | readonly Json[]
  | { readonly [key: string]: Json };

export type ToolErrorCode =
  /** The id is not in the scene the manifest describes. */
  | 'unknown-id'
  /** Arguments malformed for this tool on this object (arity, non-finite). */
  | 'bad-args'
  /** The object exists but is not something this tool can act on. */
  | 'not-evaluable'
  /** whyChanged on something with no computation behind it (an input, a view). */
  | 'not-derived'
  /** A candidate log did not fold — the gate's or replay's complaint, verbatim. */
  | 'rejected'
  /** The evaluation left the object's domain (a non-finite result). */
  | 'domain'
  /** The scene itself threw while a tool was reading it. */
  | 'failed';

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
}

export type ToolResult =
  | { readonly ok: true; readonly value: Json }
  | { readonly ok: false; readonly error: ToolError };

export interface SetSpec {
  readonly id: Id;
  readonly value: number;
}

export type ToolCall =
  | { readonly tool: 'inspect'; readonly id: Id }
  | { readonly tool: 'evalAt'; readonly id: Id; readonly args: readonly number[] }
  | { readonly tool: 'whyChanged'; readonly id: Id }
  | { readonly tool: 'counterfactual'; readonly set: readonly SetSpec[]; readonly read: readonly Id[] }
  | {
      readonly tool: 'bisectFlip';
      readonly param: Id;
      readonly claim: Id;
      readonly lo: number;
      readonly hi: number;
      readonly maxProbes?: number;
    }
  | { readonly tool: 'setInput'; readonly id: Id; readonly value: number }
  | { readonly tool: 'appendFragment'; readonly source: string };

/** The scene as ids → live handles. Build with `sceneIndex(stage)` — only. */
export type SceneMap = ReadonlyMap<Id, Handle>;

/**
 * Fold a CANDIDATE log into a fresh, disposable scene and hand back its index
 * — or the replay failure. This is `commitEntry`'s transaction machinery worn
 * as a hook: the caller builds a throwaway world, replays, and never touches
 * the live one. Determinism (state = fold(log)) is what makes the folded
 * scene's ids line up with the live scene's.
 */
export type FoldOutcome =
  | { readonly ok: true; readonly scene: SceneMap }
  | { readonly ok: false; readonly failure: ReplayFailure };

export type FoldScene = (candidate: ConversationLog) => Promise<FoldOutcome> | FoldOutcome;

/**
 * The 4b pipeline as a hook: compile + gate a fragment's source. Callers wire
 * it with the planner's `compileFragment` (which runs the lint gate); this
 * module cannot import the planner — the dependency points the other way.
 */
export type CompileFragment = (
  source: string,
) =>
  | Promise<{ ok: true; js: string } | { ok: false; errors: readonly string[] }>
  | { ok: true; js: string }
  | { ok: false; errors: readonly string[] };

export interface ToolHooks {
  /**
   * The live scene's index, built PER DISPATCH — a tool between two student
   * drags must see the scene as it stands, not as it stood at loop start.
   * Read probes resolve against it and never mutate it.
   */
  readonly scene: () => SceneMap;
  /** The conversation so far — what experiments fold and writes extend. */
  readonly log?: ConversationLog;
  /** The disposable fold. Required by the experiment probes and the writes. */
  readonly fold?: FoldScene;
  /** Compile + gate. Required by appendFragment only. */
  readonly compile?: CompileFragment;
}

const ok = (value: Json): ToolResult => ({ ok: true, value });
const err = (code: ToolErrorCode, message: string): ToolResult => ({
  ok: false,
  error: { code, message },
});

/**
 * The one resolution path every tool shares. The message states the boundary
 * rule rather than just the miss, because in the loop this text IS what the
 * model reads next.
 */
function reach(scene: SceneMap, id: Id): Handle | ToolResult {
  const found = scene.get(id);
  if (found) return found;
  return err(
    'unknown-id',
    `"${id}" is not in the scene. A tool may reach exactly what the scene manifest offers — ` +
      `never an object the student was not shown, and never a retired one.`,
  );
}

function isToolResult(x: Handle | ToolResult): x is ToolResult {
  return typeof (x as { ok?: unknown }).ok === 'boolean';
}

// ─────────────────────────── structural probes ───────────────────────────
// Everything in the engine is a frozen object literal, so these are duck-typed
// rather than instanceof — the same choice manifest.ts already made, and for
// the same reason: the library's shapes are contracts, not classes.

interface ClaimLike {
  readonly holds: boolean;
  readonly evidence?: string;
  readonly label?: string;
  readonly relation?: string;
  readonly tolerance?: number;
  readonly lhs?: { readonly value: number };
  readonly rhs?: { readonly value: number };
  readonly gap?: { readonly value: number };
}

function asClaim(h: Handle): ClaimLike | undefined {
  return h.kind === 'claim' && typeof (h as unknown as ClaimLike).holds === 'boolean'
    ? (h as unknown as ClaimLike)
    : undefined;
}

function labelOf(h: Handle): string | undefined {
  const l = (h as { label?: unknown }).label;
  return typeof l === 'string' ? l : undefined;
}

/**
 * Render a scene value as JSON, or nothing. A `Verdict` becomes its label —
 * `holds`/`broken` is what a model can narrate; `polarity` is view plumbing.
 */
function jsonValue(v: unknown): Json | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const items = v.map(jsonValue);
    return items.every((x): x is Json => x !== undefined) ? items : undefined;
  }
  if (v !== null && typeof v === 'object') {
    const verdict = v as { label?: unknown; polarity?: unknown };
    if (typeof verdict.label === 'string' && typeof verdict.polarity === 'string') {
      return verdict.label;
    }
  }
  return undefined;
}

// ─────────────────────────────── inspect ───────────────────────────────

interface StochasticMatrixLike {
  valuesTracked(): ReadonlyArray<readonly number[]>;
  readonly states: { readonly items: ReadonlyArray<{ readonly label: string }> };
}

interface Matrix2Like {
  readonly entries: ReadonlyArray<{ readonly value: number }>;
}

interface LoopLike {
  points(): ReadonlyArray<readonly [number, number]>;
  readonly area: { readonly value: number };
  readonly label?: string;
}

interface SegmentLike {
  from(): readonly [number, number];
  to(): readonly [number, number];
  readonly orientation: 1 | -1;
  readonly index: number;
}

interface DistributionLike {
  readonly states: { readonly items: ReadonlyArray<{ readonly label: string } & Handle> };
  mass(state: Handle): number;
  readonly label?: string;
}

/**
 * The full structured value of ONE object — what the manifest deliberately
 * keeps terse, on demand. Dispatch is by kind; anything without a richer shape
 * falls through to `{id, kind, label?, value?}`, which is never an error: an
 * object the manifest offered is always at least inspectable as itself.
 */
export function inspect(scene: SceneMap, id: Id): ToolResult {
  const h = reach(scene, id);
  if (isToolResult(h)) return h;

  const base: Record<string, Json> = { id: h.id, kind: h.kind };
  const label = labelOf(h);
  if (label !== undefined) base['label'] = label;

  const claim = asClaim(h);
  if (claim) {
    return ok({
      ...base,
      holds: claim.holds,
      // absent only on a claim predating the field; under-claim, as the manifest does
      evidence: claim.evidence ?? 'authored-predicate',
      ...(claim.relation !== undefined ? { relation: claim.relation } : {}),
      ...(claim.tolerance !== undefined ? { tolerance: claim.tolerance } : {}),
      ...(claim.lhs ? { lhs: claim.lhs.value } : {}),
      ...(claim.rhs ? { rhs: claim.rhs.value } : {}),
      ...(claim.gap ? { gap: claim.gap.value } : {}),
    });
  }

  if (h.kind === 'parameter') {
    const p = h as unknown as { value: number; range: readonly [number, number] };
    return ok({ ...base, value: p.value, range: [p.range[0], p.range[1]] });
  }

  if (h.kind === 'matrix') {
    // Two libraries mint kind "matrix" (linalg's 2×2 and prob's stochastic);
    // they are told apart structurally, exactly as linalg.ts itself does.
    const stochastic = h as unknown as Partial<StochasticMatrixLike>;
    if (typeof stochastic.valuesTracked === 'function' && stochastic.states) {
      return ok({
        ...base,
        states: stochastic.states.items.map((s) => s.label),
        rows: stochastic.valuesTracked!().map((row) => [...row]),
      });
    }
    const m = h as unknown as Partial<Matrix2Like>;
    if (Array.isArray(m.entries)) {
      const e = m.entries.map((cell) => cell.value);
      return ok({ ...base, entries: [e.slice(0, 2), e.slice(2, 4)] });
    }
  }

  if (h.kind === 'loop') {
    const loop = h as unknown as LoopLike;
    return ok({
      ...base,
      vertices: loop.points().map((p) => [p[0], p[1]]),
      area: loop.area.value,
    });
  }

  if (h.kind === 'segment') {
    const s = h as unknown as SegmentLike;
    return ok({
      ...base,
      index: s.index,
      orientation: s.orientation,
      from: [...s.from()],
      to: [...s.to()],
    });
  }

  if (h.kind === 'distribution') {
    const d = h as unknown as DistributionLike;
    const weights: Record<string, Json> = {};
    for (const s of d.states.items) weights[s.label] = d.mass(s);
    return ok({ ...base, weights });
  }

  const value = jsonValue((h as { value?: unknown }).value);
  return ok(value !== undefined ? { ...base, value } : base);
}

// ─────────────────────────────── evalAt ───────────────────────────────

/** kind → how many coordinates its rule takes. What is absent is not evaluable. */
const EVAL_ARITY: Record<string, number> = {
  vectorField: 2,
  scalarField: 2,
  fn: 1,
  accumulation: 1,
};

/**
 * Sample a field or function handle at a point. The rules are authored
 * closures the object already carries (`at` reads them), so this is the
 * engine doing arithmetic the model must never do itself — grounded in the
 * actual scene object, not a formula the model remembers writing.
 */
export function evalAt(scene: SceneMap, id: Id, args: readonly number[]): ToolResult {
  const h = reach(scene, id);
  if (isToolResult(h)) return h;

  const arity = EVAL_ARITY[h.kind];
  if (arity === undefined) {
    return err(
      'not-evaluable',
      `"${id}" is a ${h.kind}, which has no rule to sample. evalAt takes a vectorField or ` +
        `scalarField at (x, y), or a fn / accumulation at x.`,
    );
  }
  if (args.length !== arity || !args.every((a) => typeof a === 'number' && Number.isFinite(a))) {
    return err(
      'bad-args',
      `evalAt("${id}") wants exactly ${arity} finite coordinate${arity === 1 ? '' : 's'}; ` +
        `got [${args.map(String).join(', ')}].`,
    );
  }

  const at = (h as unknown as { at: (...xs: number[]) => number | readonly number[] }).at;
  const result = at.call(h, ...args);
  const value = jsonValue(result);
  if (value === undefined) {
    return err(
      'domain',
      `"${id}" is not finite at (${args.join(', ')}) — the point is outside the rule's domain.`,
    );
  }
  return ok(value);
}

// ─────────────────────────────── whyChanged ───────────────────────────────

/** What the walk needs of a reactive cell. `dependsOn` is core's 4c retention. */
interface CellLike extends Handle {
  dependsOn?(): readonly Handle[];
  peek?(): unknown;
}

/** A handle that knows its backing cell (Live carries it; Parameter its id). */
interface Celled {
  readonly cell?: CellLike;
  readonly cellId?: string;
}

/** One link of the causal chain — exactly what a model needs to narrate it. */
export interface WhyChangedEntry {
  readonly id: Id;
  readonly kind: string;
  readonly label?: string;
  readonly value?: Json;
}

const CLAIM_PARTS = ['verdict', 'gap', 'lhs', 'rhs'] as const;

/**
 * cell id → the scene handle that owns it. The reactive graph speaks in raw
 * cells (`slot#3`, `derived#7`); the scene speaks in handles a student was
 * shown. This map is the translation, built from the SAME index every tool
 * resolves through — so a retired object's cells stay unattributed, exactly
 * as its handle stays unreachable. A claim's sub-handles (verdict, gap, the
 * two sides) are reachable through the claim, so they are owners too.
 */
function cellOwners(scene: SceneMap): Map<string, Handle> {
  const owners = new Map<string, Handle>();
  const claim = (h: Handle, part: string): Handle | undefined => {
    const sub = (h as unknown as Record<string, unknown>)[part];
    return sub !== null && typeof sub === 'object' && typeof (sub as Handle).id === 'string'
      ? (sub as Handle)
      : undefined;
  };
  const register = (h: Handle): void => {
    const { cell, cellId } = h as unknown as Celled;
    if (cell && typeof cell.id === 'string' && !owners.has(cell.id)) owners.set(cell.id, h);
    if (typeof cellId === 'string' && !owners.has(cellId)) owners.set(cellId, h);
  };
  for (const h of scene.values()) {
    register(h);
    if (h.kind === 'claim') {
      for (const part of CLAIM_PARTS) {
        const sub = claim(h, part);
        if (sub) register(sub);
      }
    }
  }
  return owners;
}

function chainEntry(h: Handle): WhyChangedEntry {
  const label = labelOf(h);
  const claim = asClaim(h);
  const value =
    claim !== undefined
      ? claim.holds
      : (jsonValue((h as { value?: unknown }).value) ??
        (typeof (h as CellLike).peek === 'function'
          ? jsonValue((h as CellLike).peek!())
          : undefined));
  return {
    id: h.id,
    kind: h.kind,
    ...(label !== undefined ? { label } : {}),
    ...(value !== undefined ? { value } : {}),
  };
}

/** The cell a handle's liveness comes from: a claim's verdict, a Live's own. */
function cellBehind(h: Handle): CellLike | undefined {
  const claimVerdict = (h as { verdict?: Celled }).verdict?.cell;
  if (claimVerdict) return claimVerdict;
  return (h as unknown as Celled).cell;
}

/**
 * The dependency path from a derived value or claim verdict back to the root
 * inputs, read off the reactive graph — causality, not narration. The chain
 * is ordered from the asked-about thing to the roots; each raw cell is
 * attributed to the scene handle that owns it when one does (a slot to its
 * parameter, a derived to its Live), and shown as itself when none does.
 *
 * The edges are the CURRENT value's (dependsOn pulls first), which is the
 * question "why is this what it is now" — the only question a live scene can
 * answer exactly.
 */
export function whyChanged(scene: SceneMap, id: Id): ToolResult {
  const h = reach(scene, id);
  if (isToolResult(h)) return h;

  const start = cellBehind(h);
  if (!start) {
    const isInput = typeof (h as unknown as Celled).cellId === 'string';
    return err(
      'not-derived',
      isInput
        ? `"${id}" is an INPUT — nothing upstream moves it. It changes when the lesson or the ` +
          `student sets it; its history is the set-input events in the conversation log.`
        : `"${id}" has no reactive cell behind it, so there is no dependency path to walk. ` +
          `whyChanged works on derived values and claims.`,
    );
  }

  const owners = cellOwners(scene);
  const chain: WhyChangedEntry[] = [chainEntry(h)];
  const visited = new Set<string>([start.id]);
  const named = new Set<Id>([h.id]);

  const walk = (cell: CellLike): void => {
    for (const dep of cell.dependsOn?.() ?? []) {
      if (visited.has(dep.id)) continue;
      visited.add(dep.id);
      const owner = owners.get(dep.id) ?? dep;
      if (!named.has(owner.id)) {
        named.add(owner.id);
        chain.push(chainEntry(owner));
      }
      walk(dep as CellLike);
    }
  };
  walk(start);

  return ok({ chain: chain as unknown as Json });
}

// ───────────────────────────── experiment probes ─────────────────────────────
// Where determinism pays out: state = fold(log), so an experiment is a
// candidate log folded somewhere disposable, read, and thrown away. The live
// scene cannot be touched by construction — the probe never holds it.

const setEvent = (s: SetSpec): EventEntry => ({
  kind: 'event',
  event: { type: 'set-input', target: s.id, value: s.value },
});

const foldRejected = (failure: ReplayFailure): ToolResult =>
  err(
    'rejected',
    `the candidate did not fold: the ${failure.kind} at position ${failure.index} broke the ` +
      `scene: ${failure.message}`,
  );

/**
 * "Would claim#2 still hold at k = 5?" — append the set-input events to a
 * CANDIDATE log, fold it headlessly, read the requested objects there,
 * discard. Nothing is committed and nothing on screen moves; the answer is
 * grounded in the actual scene objects because the fold ran the actual
 * program.
 */
export async function counterfactual(
  log: ConversationLog,
  fold: FoldScene,
  args: { readonly set: readonly SetSpec[]; readonly read: readonly Id[] },
): Promise<ToolResult> {
  if (args.set.length === 0 || args.read.length === 0) {
    return err('bad-args', 'counterfactual wants at least one {id, value} to set and one id to read.');
  }
  for (const s of args.set) {
    if (typeof s.value !== 'number' || !Number.isFinite(s.value)) {
      return err('bad-args', `counterfactual: the value for "${s.id}" must be a finite number.`);
    }
  }
  const outcome = await fold([...log, ...args.set.map(setEvent)]);
  if (!outcome.ok) return foldRejected(outcome.failure);

  const reads: Json[] = [];
  for (const id of args.read) {
    const r = inspect(outcome.scene, id);
    // an unreadable id fails the whole probe — it names the boundary, and a
    // partial answer would invite the model to fill the gap by guessing
    if (!r.ok) return r;
    reads.push(r.value);
  }
  return ok({ reads });
}

/** How the folded scene answers "does this claim hold?", shared by bisect. */
function holdsIn(scene: SceneMap, claimId: Id): boolean | ToolResult {
  const h = reach(scene, claimId);
  if (isToolResult(h)) return h;
  const claim = asClaim(h);
  if (!claim) {
    return err('bad-args', `"${claimId}" is a ${h.kind}, not a claim — bisectFlip needs a claim to watch.`);
  }
  return claim.holds;
}

/** Iteration cap: past ~40 halvings a double's mantissa is exhausted anyway. */
const BISECT_DEFAULT_PROBES = 40;
const BISECT_MAX_PROBES = 60;

/**
 * Binary-search the parameter value where a claim's verdict flips, each probe
 * one disposable fold. Returns the bracketing interval with the verdict at
 * both ends — the exact threshold no snapshot could contain — or a typed
 * no-flip result when both ends agree (which is itself an answer: within
 * [lo, hi], the claim never changes its mind).
 *
 * Determinism makes this exact rather than statistical: the same fold at the
 * same value answers the same way every time, so the bracket is a fact about
 * the scene, not about a run.
 */
export async function bisectFlip(
  log: ConversationLog,
  fold: FoldScene,
  args: {
    readonly param: Id;
    readonly claim: Id;
    readonly lo: number;
    readonly hi: number;
    readonly maxProbes?: number;
  },
): Promise<ToolResult> {
  const { param, claim } = args;
  if (![args.lo, args.hi].every(Number.isFinite) || !(args.lo < args.hi)) {
    return err('bad-args', `bisectFlip wants finite bounds with lo < hi; got [${args.lo}, ${args.hi}].`);
  }
  const cap = Math.min(BISECT_MAX_PROBES, Math.max(2, args.maxProbes ?? BISECT_DEFAULT_PROBES));

  let probes = 0;
  const probe = async (value: number): Promise<boolean | ToolResult> => {
    probes += 1;
    const outcome = await fold([...log, setEvent({ id: param, value })]);
    if (!outcome.ok) return foldRejected(outcome.failure);
    return holdsIn(outcome.scene, claim);
  };

  let lo = args.lo;
  let hi = args.hi;
  const holdsAtLo = await probe(lo);
  if (typeof holdsAtLo !== 'boolean') return holdsAtLo;
  const holdsAtHi = await probe(hi);
  if (typeof holdsAtHi !== 'boolean') return holdsAtHi;

  if (holdsAtLo === holdsAtHi) {
    return ok({ flipped: false, lo, hi, holdsAtLo, holdsAtHi, probes });
  }

  while (probes < cap) {
    const mid = lo + (hi - lo) / 2;
    if (mid === lo || mid === hi) break; // the doubles are adjacent: exact
    const holdsAtMid = await probe(mid);
    if (typeof holdsAtMid !== 'boolean') return holdsAtMid;
    if (holdsAtMid === holdsAtLo) lo = mid;
    else hi = mid;
  }

  return ok({ flipped: true, lo, hi, holdsAtLo, holdsAtHi, probes });
}

// ─────────────────────────────── write acts ───────────────────────────────
// Thin wrappers over commitEntry: the candidate folds somewhere disposable
// FIRST, and only an accepted entry advances the log. The tools return the
// advanced log rather than touching the live stage — the log is the artifact,
// and reflecting it on screen (a re-fold, a poke) stays the caller's act,
// exactly as it is for the classifier's manipulate path today.

/** A write's answer: the tool result, plus the log as it stands after it. */
export interface WriteOutcome {
  readonly result: ToolResult;
  /** Advanced by a committed write; the input log, untouched, on rejection. */
  readonly log: ConversationLog;
}

/** commitEntry speaks ReplayResult; the fold hook speaks scenes. Adapt. */
const asTryFold =
  (fold: FoldScene) =>
  async (candidate: ConversationLog): Promise<ReplayResult> => {
    const outcome = await fold(candidate);
    return outcome.ok ? { ok: true } : { ok: false, failure: outcome.failure };
  };

/**
 * The event path as a tool: one SetInputEvent, committed via commitEntry. A
 * target the scene does not offer, or one that is not settable, is the fold's
 * rejection — the same complaint a replayed cassette would raise, verbatim.
 */
export async function setInput(
  log: ConversationLog,
  fold: FoldScene,
  args: { readonly id: Id; readonly value: number },
): Promise<WriteOutcome> {
  if (typeof args.value !== 'number' || !Number.isFinite(args.value)) {
    return { result: err('bad-args', `setInput("${args.id}") wants a finite number.`), log };
  }
  const committed = await commitEntry(log, setEvent(args), asTryFold(fold));
  if (!committed.ok) {
    return { result: err('rejected', committed.errors.join('\n')), log };
  }
  return { result: ok({ set: args.id, to: args.value }), log: committed.log };
}

/**
 * The 4b pipeline as a tool. The gate runs on the argument, and a rejection
 * returns as the tool error VERBATIM — in the loop that is the repair brief
 * becoming ordinary tool-retry, with no separate machinery. A fragment that
 * gates but breaks the fold (a bad id, a guest throw) is rejected the same
 * way, and the previous log comes back untouched.
 */
export async function appendFragment(
  log: ConversationLog,
  fold: FoldScene,
  compile: CompileFragment,
  args: { readonly source: string },
): Promise<WriteOutcome> {
  if (typeof args.source !== 'string' || args.source.trim() === '') {
    return { result: err('bad-args', 'appendFragment wants non-empty program source.'), log };
  }
  const compiled = await compile(args.source);
  if (!compiled.ok) {
    return { result: err('rejected', compiled.errors.join('\n')), log };
  }
  const entry: FragmentEntry = { kind: 'fragment', source: args.source, js: compiled.js };
  const committed = await commitEntry(log, entry, asTryFold(fold));
  if (!committed.ok) {
    return { result: err('rejected', committed.errors.join('\n')), log };
  }
  return { result: ok({ appended: true, entries: committed.log.length }), log: committed.log };
}

// ─────────────────────────────── dispatch ───────────────────────────────

export interface ToolOutcome {
  /** JSON-serializable either way — in the loop this is what the model reads. */
  readonly result: ToolResult;
  /**
   * The conversation after this call: advanced by a committed write, passed
   * through unchanged by everything else. Absent only when the loop was wired
   * without a log at all.
   */
  readonly log?: ConversationLog;
}

/**
 * One entry point for the eventual loop: a typed call in, data out, no throw.
 * The catch is the last line of the errors-are-data rule — a derived that
 * throws mid-read is the scene's failure, and the model should be told, not
 * the process killed.
 */
export async function runTool(call: ToolCall, hooks: ToolHooks): Promise<ToolOutcome> {
  const passthrough = hooks.log !== undefined ? { log: hooks.log } : {};
  const unwired = (what: string): ToolOutcome => ({
    result: err('failed', `this loop was wired without ${what}, so "${call.tool}" cannot run`),
    ...passthrough,
  });
  try {
    switch (call.tool) {
      case 'inspect':
        return { result: inspect(hooks.scene(), call.id), ...passthrough };
      case 'evalAt':
        return { result: evalAt(hooks.scene(), call.id, call.args), ...passthrough };
      case 'whyChanged':
        return { result: whyChanged(hooks.scene(), call.id), ...passthrough };
      case 'counterfactual':
      case 'bisectFlip': {
        const { log, fold } = hooks;
        if (!log || !fold) return unwired('a log and a fold hook');
        if (call.tool === 'counterfactual') {
          return { result: await counterfactual(log, fold, call), log };
        }
        return { result: await bisectFlip(log, fold, call), log };
      }
      case 'setInput': {
        const { log, fold } = hooks;
        if (!log || !fold) return unwired('a log and a fold hook');
        return await setInput(log, fold, call);
      }
      case 'appendFragment': {
        const { log, fold, compile } = hooks;
        if (!log || !fold || !compile) return unwired('a log, a fold and a compile hook');
        return await appendFragment(log, fold, compile, call);
      }
      default:
        // A malformed call is loop input, not caller code — answer it as data.
        return {
          result: err('bad-args', `unknown tool "${(call as { tool: string }).tool}"`),
          ...passthrough,
        };
    }
  } catch (e) {
    return {
      result: err('failed', e instanceof Error ? e.message : String(e)),
      ...passthrough,
    };
  }
}
