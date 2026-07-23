/**
 * manifest.ts — the scene, described for a model (roadmap step 4a).
 *
 * A follow-up question ("why did that turn red?") cannot be answered from the
 * program text alone, because the program text is what the scene was at t=0
 * and the student has since dragged things. So a conversational turn needs a
 * description of the scene AS IT NOW STANDS, and this builds it.
 *
 * Read-only, on purpose. This step mutates nothing and generates no program
 * fragment — the write path is step 4b, and testing the manifest in isolation
 * first is the whole reason the roadmap split them.
 *
 * ## Where the values come from
 *
 * There is no registry of every minted handle (`IdRegistry` keeps counters,
 * not objects), so the manifest cannot enumerate the world. It does not need
 * to: it walks the two places that DID retain references —
 *
 *   - `stage.views`, every view a program constructed, and
 *   - `world.timeline`, whose step payloads hold the LIVE host objects
 *     (`ShowPayload.subject`, `VaryPayload.target`, an interaction's target…),
 *
 * and reads `.value` off them now. That is what makes student drags visible
 * for free: a drag calls `setValueLive` on the very object the timeline points
 * at, so there is no separate interaction store to consult and no chance of
 * the manifest disagreeing with the screen.
 *
 * The honest limitation, stated rather than hidden: **an object the program
 * built but never showed, varied, exposed, mentioned or linked is invisible
 * here.** It is also invisible to the student, which is why that is the right
 * boundary for a manifest whose job is answering questions about what is on
 * screen.
 *
 * ## Claims are labeled by HOW they were judged
 *
 * `evidence` is carried through verbatim from the claim. A model handed a bare
 * `holds: true` will happily narrate an LLM-authored predicate's opinion as a
 * proof; `authored-predicate` is the word that stops it, and `sampled` is the
 * word that stops "these are equal" when what was checked is "these agree to
 * 0.01 at the current values".
 */

import { isHandle } from '@math-ai/core';
import type { Handle, Id, TimelineNode, World } from '@math-ai/core';
import type {
  BeatPayload,
  EnableInteractionPayload,
  ExposePayload,
  FocusPayload,
  HidePayload,
  LinkPayload,
  ReplacePayload,
  RetirePayload,
  SayPayload,
  ShowPayload,
  VaryPayload,
} from '@math-ai/lesson';
import type { Stage } from './stage.js';
import { labelOf } from './util.js';

/** How a claim's verdict was reached — mirrors `ClaimEvidence` in the library. */
export type ManifestEvidence = 'exact-comparison' | 'sampled' | 'authored-predicate';

export interface ManifestObject {
  readonly id: Id;
  readonly kind: string;
  readonly label?: string;
  /** The CURRENT value, including anything the student dragged. */
  readonly value?: number | string | boolean;
  /** A Parameter's clamp — the range a follow-up may legally ask for. */
  readonly range?: readonly [number, number];
  /** True when the student can move this: it was exposed or given a drag rail. */
  readonly draggable?: boolean;
  /** True when the object is currently mounted on screen. */
  readonly onScreen?: boolean;
}

export interface ManifestClaim {
  readonly id: Id;
  readonly label?: string;
  readonly holds: boolean;
  /**
   * NEVER omit this when presenting a verdict. `authored-predicate` means a
   * closure the model itself wrote returned true — the engine ran it, it did
   * not check it.
   */
  readonly evidence: ManifestEvidence;
  readonly relation?: string;
  readonly tolerance?: number;
  readonly lhs?: number;
  readonly rhs?: number;
  readonly gap?: number;
}

export interface ManifestView {
  readonly id: Id;
  readonly kind: string;
  readonly label?: string;
  readonly shown: boolean;
  /** Ids of the semantic objects this view projects. */
  readonly projects: readonly Id[];
}

export interface ManifestBeat {
  readonly index: number;
  readonly title: string;
}

export interface SceneManifest {
  readonly beats: readonly ManifestBeat[];
  /** The prose the student has actually been shown, in order. */
  readonly narration: readonly string[];
  readonly views: readonly ManifestView[];
  readonly objects: readonly ManifestObject[];
  readonly claims: readonly ManifestClaim[];
}

// ─────────────────────────── structural probes ───────────────────────────
// Everything in this engine is a frozen object literal, so these are all
// duck-typed rather than instanceof. That is the same choice `isHandle` and
// `isLive` already make.

interface ClaimLike extends Handle {
  readonly holds: boolean;
  readonly evidence?: string;
  readonly relation?: string;
  readonly tolerance?: number;
  readonly lhs?: { value: number };
  readonly rhs?: { value: number };
  readonly gap?: { value: number };
}

function isClaimLike(h: Handle): h is ClaimLike {
  return h.kind === 'claim' && typeof (h as { holds?: unknown }).holds === 'boolean';
}

function currentValue(h: Handle): number | string | boolean | undefined {
  const v = (h as { value?: unknown }).value;
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : undefined;
}

function rangeOf(h: Handle): readonly [number, number] | undefined {
  const r = (h as { range?: unknown }).range;
  return Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number'
    ? ([r[0], r[1]] as const)
    : undefined;
}

function labelIfNamed(h: Handle): string | undefined {
  const l = labelOf(h);
  // labelOf falls back to the id, which is noise here — the id is already a field.
  return l === h.id ? undefined : l;
}

// ───────────────────────────── the timeline walk ─────────────────────────────

/**
 * Every handle a step mentions, and whether the step makes it student-movable.
 *
 * `vary` counts as movable-adjacent but NOT draggable: the lesson moved it,
 * the student cannot. Only `expose` and `enableInteraction` hand over control,
 * and conflating them would tell a follow-up it may set something it cannot.
 */
function collect(
  node: TimelineNode,
  seen: Map<Id, Handle>,
  draggable: Set<Id>,
  narration: string[],
  retired: Set<Id>,
): void {
  if (node.type === 'cascade' || node.type === 'parallel' || node.type === 'loop') {
    const children = (node as { children?: readonly TimelineNode[] }).children ?? [];
    for (const c of children) collect(c, seen, draggable, narration, retired);
    const iterations = (node as { iterations?: readonly TimelineNode[] }).iterations ?? [];
    for (const c of iterations) collect(c, seen, draggable, narration, retired);
    return;
  }
  if (node.type !== 'action') return;

  const keep = (h: unknown): void => {
    if (isHandle(h) && !seen.has(h.id)) seen.set(h.id, h);
  };
  const p = node.payload as Record<string, unknown> | undefined;
  if (!p) return;

  switch (node.op) {
    case 'say': {
      const say = p as unknown as SayPayload;
      narration.push(say.strings.join('…').trim());
      for (const m of say.mentions) keep(m);
      return;
    }
    case 'show':
      keep((p as unknown as ShowPayload).subject);
      return;
    case 'hide':
      keep((p as unknown as HidePayload).subject);
      return;
    case 'retire': {
      // Retired, not merely hidden: the object is out of the explanation, so a
      // follow-up must not be offered it as something to reason about or move.
      // This is the whole reason `retire` had to exist separately from `hide`.
      retired.add((p as unknown as RetirePayload).subject.id);
      return;
    }
    case 'replace': {
      const r = p as unknown as ReplacePayload;
      retired.add(r.old.id);
      keep(r.next);
      return;
    }
    case 'focus':
      for (const s of (p as unknown as FocusPayload).subjects) keep(s);
      return;
    case 'vary':
      keep((p as unknown as VaryPayload).target);
      return;
    case 'expose': {
      const e = p as unknown as ExposePayload;
      keep(e.subject);
      draggable.add(e.subject.id);
      return;
    }
    case 'enableInteraction': {
      const i = (p as unknown as EnableInteractionPayload).interaction;
      keep(i.target);
      keep(i.along);
      draggable.add(i.target.id);
      return;
    }
    case 'link': {
      const l = p as unknown as LinkPayload;
      keep(l.a);
      for (const t of l.targets) keep(t);
      return;
    }
    default: {
      // Every other verb (morph, demonstrate, buildUp, compareExperiment,
      // transformFormula) carries handles under names this switch does not
      // know. Sweep them generically rather than enumerating payload shapes
      // that will drift — a manifest that silently misses new verbs is worse
      // than one that occasionally names a handle the student cannot see.
      for (const v of Object.values(p)) {
        if (Array.isArray(v)) v.forEach(keep);
        else keep(v);
      }
    }
  }
}

// ─────────────────────────────── the manifest ───────────────────────────────

/**
 * Describe the scene as it now stands.
 *
 * `world` is taken from the stage, so a caller cannot accidentally hand in a
 * different one than the views were built against.
 */
export function sceneManifest(stage: Stage): SceneManifest {
  const world: World = stage.world;
  const seen = new Map<Id, Handle>();
  const draggable = new Set<Id>();
  const narration: string[] = [];
  const retired = new Set<Id>();
  const beats: ManifestBeat[] = [];

  for (const node of world.timeline.root) {
    if (node.type === 'action' && node.op === 'beat') {
      const b = node.payload as unknown as BeatPayload;
      beats.push({ index: b.index, title: b.title });
    }
    collect(node, seen, draggable, narration, retired);
  }
  for (const id of retired) seen.delete(id);

  // views also hold the objects they project, which is how a readout's subject
  // gets into the manifest even when only the VIEW was shown.
  const views: ManifestView[] = stage.views
    .filter((v) => !retired.has(v.id))
    .map((v) => {
      for (const e of v.elements) if (!retired.has(e.id) && !seen.has(e.id)) seen.set(e.id, e);
      return {
        id: v.id,
        kind: v.kind,
        label: labelIfNamed(v as unknown as Handle),
        shown: v.shown,
        projects: v.elements.map((e) => e.id).filter((id) => id !== v.id && !retired.has(id)),
      };
    });

  const claims: ManifestClaim[] = [];
  const objects: ManifestObject[] = [];

  for (const [id, h] of seen) {
    if (isClaimLike(h)) {
      claims.push({
        id,
        label: labelIfNamed(h),
        holds: h.holds,
        // A claim built before this field existed would report as a predicate,
        // which is the SAFE default: it under-claims rather than over-claims.
        evidence: (h.evidence as ManifestEvidence | undefined) ?? 'authored-predicate',
        relation: h.relation,
        tolerance: h.tolerance,
        lhs: h.lhs?.value,
        rhs: h.rhs?.value,
        gap: h.gap?.value,
      });
      continue;
    }
    const value = currentValue(h);
    const range = rangeOf(h);
    const isDraggable = draggable.has(id);
    // Objects with nothing live and nothing to say about them are noise in a
    // prompt. Keep only what a follow-up could actually reason over or move.
    if (value === undefined && !range && !isDraggable) continue;
    objects.push({
      id,
      kind: h.kind,
      label: labelIfNamed(h),
      ...(value !== undefined ? { value } : {}),
      ...(range ? { range } : {}),
      ...(isDraggable ? { draggable: true } : {}),
      ...(stage.registry.has(id) ? { onScreen: true } : {}),
    });
  }

  return { beats, narration, views, objects, claims };
}

// ─────────────────────────── the transition feed ───────────────────────────

/** One student move since the last question, with the label a model narrates by. */
export interface ManifestMove {
  readonly target: Id;
  readonly value: number;
  readonly label?: string;
}

/** A claim whose verdict changed between two manifests. */
export interface ClaimFlip {
  readonly id: Id;
  readonly label?: string;
  readonly from: boolean;
  readonly to: boolean;
}

export interface TransitionFeed {
  /** The coalesced set-input events, labeled from the AFTER manifest. */
  readonly moved: readonly ManifestMove[];
  readonly flipped: readonly ClaimFlip[];
}

/**
 * "Since the last question" (roadmap 4c): the manifest describes NOW, but
 * "why did that turn red?" is a question about a TRANSITION — so the brief
 * needs what moved and which verdicts flipped, not just the state.
 *
 * `before`/`after` are two snapshots of `sceneManifest` bracketing the gap;
 * `moved` is the log tail's student events, already coalesced by the caller
 * (`studentEvents(coalesce(tail))` — the host owns the log, this module owns
 * the manifests, and the seam keeps it that way). A claim only counts as
 * flipped when BOTH snapshots hold it: one that appeared in between has no
 * before-verdict to compare, and inventing one would be narration, not data.
 */
export function transitionFeed(
  before: SceneManifest,
  after: SceneManifest,
  moved: readonly { readonly target: Id; readonly value: number }[],
): TransitionFeed {
  const labels = new Map<Id, string | undefined>(after.objects.map((o) => [o.id, o.label]));
  const was = new Map<Id, ManifestClaim>(before.claims.map((c) => [c.id, c]));
  const flipped: ClaimFlip[] = [];
  for (const claim of after.claims) {
    const earlier = was.get(claim.id);
    if (earlier && earlier.holds !== claim.holds) {
      flipped.push({
        id: claim.id,
        ...(claim.label !== undefined ? { label: claim.label } : {}),
        from: earlier.holds,
        to: claim.holds,
      });
    }
  }
  return {
    moved: moved.map((m) => {
      const label = labels.get(m.target);
      return { target: m.target, value: m.value, ...(label !== undefined ? { label } : {}) };
    }),
    flipped,
  };
}

/**
 * The id → handle index a program FRAGMENT resolves against (roadmap 4b).
 *
 * A turn-2 fragment compiles in its own scope, so it cannot see turn-1's
 * `const`s; it reaches back by id. There is no registry of minted handles to
 * look them up in, so the index is built from exactly the same walk the
 * manifest uses — which gives the reference the right boundary for free: a
 * fragment can name anything the manifest offered it and nothing else. Naming
 * an object the student was never shown would be authoring against a scene
 * that does not, as far as anyone can tell, exist.
 *
 * Retired objects are absent here too, so a fragment cannot resurrect one by
 * id. That is `retire` doing its job rather than a special case.
 */
export function sceneIndex(stage: Stage): Map<Id, Handle> {
  const seen = new Map<Id, Handle>();
  const retired = new Set<Id>();
  for (const node of stage.world.timeline.root) {
    collect(node, seen, new Set(), [], retired);
  }
  for (const v of stage.views) {
    if (retired.has(v.id)) continue;
    seen.set(v.id, v as unknown as Handle);
    for (const e of v.elements) if (!retired.has(e.id)) seen.set(e.id, e);
  }
  for (const id of retired) seen.delete(id);
  return seen;
}
