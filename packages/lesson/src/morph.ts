/**
 * morph.ts — the morph-legality checker and route finder.
 *
 * `morph(A, B)` is legal iff every element of A reaches an element of B
 * through the correspondence graph (architecture: Spike validation / F1); the
 * animation routes along those edges, so the route — not just the boolean —
 * is the product here.
 *
 * Values derived by `autoEdges: false` (hot-path) operations record no
 * correspondence edges, so pure graph reachability cannot see them. The
 * fallback consults provenance records: a search over the combined graph
 * whose hops are correspondence edges (undirected) plus derivation links from
 * a value to its operation inputs. Both endpoints expand — source-side
 * ascent covers "the source was derived from something near the target",
 * target-side descent covers "the target was derived from the source".
 */

import { isHandle } from '@math-ai/core';
import type { Handle, Id, World } from '@math-ai/core';
import type { MorphHop, MorphRoute, MorphSubject } from './types.js';

/** A subject without declared elements is its own single element. */
export function elementsOf(subject: MorphSubject): readonly Handle[] {
  const els = subject.elements;
  return els && els.length > 0 ? els : [subject];
}

interface Visit {
  readonly node: Handle;
  readonly prev?: { readonly id: Id; readonly hop: MorphHop };
}

/**
 * BFS closure from `start` over correspondence edges (undirected) and
 * provenance derivation links (value → input), with back-pointers.
 */
function reachClosure(world: World, start: Handle): Map<Id, Visit> {
  const seen = new Map<Id, Visit>([[start.id, { node: start }]]);
  const queue: Handle[] = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const edge of world.graph.edgesOf(node)) {
      const other = edge.a.id === node.id ? edge.b : edge.a;
      if (seen.has(other.id)) continue;
      seen.set(other.id, { node: other, prev: { id: node.id, hop: { via: 'edge', edge } } });
      queue.push(other);
    }
    const prov = world.provenanceOf(node);
    if (prov) {
      for (const input of prov.inputs) {
        if (!isHandle(input) || seen.has(input.id)) continue;
        seen.set(input.id, {
          node: input,
          prev: {
            id: node.id,
            hop: { via: 'derivation', operation: prov.operation, value: node, input },
          },
        });
        queue.push(input);
      }
    }
  }
  return seen;
}

/** Reconstruct the hop list from `startId`'s closure entry back to the root. */
function hopsTo(closure: Map<Id, Visit>, targetId: Id): MorphHop[] {
  const hops: MorphHop[] = [];
  let cursor = closure.get(targetId);
  while (cursor?.prev) {
    hops.unshift(cursor.prev.hop);
    cursor = closure.get(cursor.prev.id);
  }
  return hops;
}

/**
 * Find how one source element reaches one of the target elements.
 * Preference order:
 *   1. a pure correspondence path (core's `path` query — shortest edges);
 *   2. a combined correspondence+provenance route from the source side;
 *   3. a stitched route meeting a target-side descent through provenance.
 */
export function routeFor(
  world: World,
  from: Handle,
  targets: readonly Handle[],
): MorphRoute | undefined {
  // 1 — same identity or pure edge path, shortest across targets.
  let best: { to: Handle; hops: MorphHop[] } | undefined;
  for (const to of targets) {
    const path = world.graph.path(from, to);
    if (path && (!best || path.length < best.hops.length)) {
      best = { to, hops: path.map((edge) => ({ via: 'edge', edge })) };
    }
  }
  if (best) return { from, to: best.to, hops: best.hops };

  // 2 — combined closure from the source.
  const reach = reachClosure(world, from);
  for (const to of targets) {
    const hit = reach.get(to.id);
    if (hit) return { from, to, hops: hopsTo(reach, to.id) };
  }

  // 3 — descend from each target; stitch at the first node the source reaches.
  for (const to of targets) {
    const descent = reachClosure(world, to);
    for (const [meetId] of descent) {
      if (!reach.has(meetId)) continue;
      const head = hopsTo(reach, meetId);
      const tail = hopsTo(descent, meetId).reverse();
      return { from, to, hops: [...head, ...tail] };
    }
  }
  return undefined;
}

export interface MorphCheck {
  readonly routes: readonly MorphRoute[];
  readonly unreachable: readonly Handle[];
}

export function checkMorph(world: World, from: MorphSubject, to: MorphSubject): MorphCheck {
  const targets = elementsOf(to);
  const routes: MorphRoute[] = [];
  const unreachable: Handle[] = [];
  for (const element of elementsOf(from)) {
    const route = routeFor(world, element, targets);
    if (route) routes.push(route);
    else unreachable.push(element);
  }
  return { routes, unreachable };
}

/** Diagnostic-quality error for an illegal morph. */
export function illegalMorphError(
  from: MorphSubject,
  to: MorphSubject,
  unreachable: readonly Handle[],
): Error {
  const total = elementsOf(from).length;
  const list = unreachable.map((h) => `  - ${h.id} (${h.kind})`).join('\n');
  const targets = elementsOf(to)
    .map((h) => `${h.id} (${h.kind})`)
    .join(', ');
  return new Error(
    `morph(${from.id} → ${to.id}) is illegal: ${unreachable.length} of ${total} source ` +
      `element(s) reach no element of the target through the correspondence graph:\n${list}\n` +
      `target elements considered: ${targets}\n` +
      `A morph route needs a correspondence path (recorded by construction or authored via ` +
      `lesson.link) or a provenance derivation chain. Values from operations defined with ` +
      `{ autoEdges: false } record no edges but still route through their provenance inputs — ` +
      `if an element is listed above, no such chain connects it to any target element.`,
  );
}
