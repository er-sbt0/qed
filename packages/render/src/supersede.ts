/**
 * supersede.ts — the renderer's half of ambient-loop supersession.
 *
 * Milestone 2 settled who supersedes among LESSON verbs (the next animating
 * verb referencing the loop's subject) and left `slot:set` / `collection:add`
 * open. DECISION here: **they supersede too** — a reactive mutation is an
 * animating step, and an ambient loop narrating state that just moved is
 * stale. The rule is provenance-aware, not id-only, because the loop's
 * subject is usually a *derived* value (the flow `chain.step(π)`), while the
 * mutation references the slot and its from/to values:
 *
 *   a `slot:set` / `collection:add` step supersedes an open loop iff the
 *   loop's subject IS one of {slot, from, to} / {collection, item}, or the
 *   loop subject's provenance inputs include one of them (one derivation hop).
 *
 * In the Markov beats this is exactly `current.set(p0, {via: "fade"})` ending
 * the ambient stationary flow: the flow is `chain.step(π)` and π is the set's
 * `from` value — connected, superseded. A set of an unrelated slot leaves the
 * loop running.
 */

import { isHandle } from '@math-ai/core';
import type { ActionStep, Handle, Id, World } from '@math-ai/core';

function referencedIds(step: ActionStep): readonly Id[] {
  const p = step.payload as Record<string, unknown> | undefined;
  if (!p) return [];
  const ids: Id[] = [];
  if (step.op === 'slot:set') {
    for (const key of ['slot', 'from', 'to']) {
      const v = p[key];
      if (isHandle(v)) ids.push(v.id);
    }
  } else if (step.op === 'collection:add') {
    for (const key of ['collection', 'item']) {
      const v = p[key];
      if (isHandle(v)) ids.push(v.id);
    }
  }
  return ids;
}

/** Does this reactive-mutation step supersede a loop demonstrating `loopSubject`? */
export function stepSupersedesLoop(world: World, loopSubject: Handle, step: ActionStep): boolean {
  if (step.op !== 'slot:set' && step.op !== 'collection:add') return false;
  const ids = new Set(referencedIds(step));
  if (ids.size === 0) return false;
  if (ids.has(loopSubject.id)) return true;
  const prov = world.provenanceOf(loopSubject);
  if (!prov) return false;
  return prov.inputs.some((input) => isHandle(input) && ids.has(input.id));
}
