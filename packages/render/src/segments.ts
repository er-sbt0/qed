/**
 * segments.ts — slice an authored timeline into navigable segments.
 *
 * `lesson.beat(title)` drops a zero-duration `beat` marker into the flat step
 * stream (see @math-ai/lesson). Segmentation is purely a playback concern:
 * this module cuts `timeline.root` at those markers so a player can play one
 * beat, stop, and wait for the student.
 *
 * The rules, all of them:
 *
 *   · Only TOP-LEVEL nodes are cut on. A `beat` nested inside a cascade or a
 *     parallel is not a boundary — a boundary must be a place playback can
 *     legitimately stop, and the inside of a cascade is not one. (`lesson.beat`
 *     is documented as a flat call, so this is a defensive rule, not a
 *     limitation authors are expected to meet.)
 *   · Nodes before the first marker form an implicit UNTITLED prologue
 *     segment — a program that shows its stage before naming its first beat
 *     still plays that setup as step 0.
 *   · A timeline with no markers yields exactly ONE segment containing
 *     everything: today's behaviour, one uninterrupted step.
 *   · The result is never empty. An empty timeline yields one empty segment,
 *     so `segmentCount >= 1` always holds for the player.
 *   · The marker itself is nodes[0] of the segment it opens. It executes as an
 *     unknown op (a no-op that still drains anything queued for its step id),
 *     so keeping it costs nothing and keeps the player's step feed — the thing
 *     verification harnesses synchronize on — a faithful replay of the
 *     timeline.
 *
 * Pure: no DOM, no core mutation, no lesson state.
 */

import type { ActionStep, TimelineNode } from '@math-ai/core';
import type { BeatPayload } from '@math-ai/lesson';

/** One navigable step of an explanation. */
export interface Segment {
  /** Position in the segment list (NOT the beat's own index — a prologue shifts them). */
  readonly index: number;
  /** The beat title; `undefined` for the implicit prologue / an unmarked timeline. */
  readonly title: string | undefined;
  /** The nodes to run, in order, marker included. */
  readonly nodes: readonly TimelineNode[];
}

/** Whether a timeline node is a beat boundary marker. */
export function isBeatMarker(node: TimelineNode): node is ActionStep {
  return node.type === 'action' && node.op === 'beat';
}

function titleOf(node: ActionStep): string | undefined {
  const payload = node.payload as Partial<BeatPayload> | undefined;
  const title = payload?.title;
  return typeof title === 'string' && title.length > 0 ? title : undefined;
}

/**
 * Split a timeline's top-level nodes on `beat` markers.
 *
 * Every node of the input appears in exactly one segment, in its original
 * order — segmentation never drops or reorders work.
 */
export function splitIntoSegments(root: readonly TimelineNode[]): readonly Segment[] {
  const segments: Segment[] = [];
  let title: string | undefined;
  let nodes: TimelineNode[] = [];
  const flush = (): void => {
    segments.push({ index: segments.length, title, nodes });
  };
  for (const node of root) {
    if (isBeatMarker(node)) {
      // the first marker only opens a prologue segment if there was one
      if (nodes.length > 0 || segments.length > 0) flush();
      title = titleOf(node);
      nodes = [node];
      continue;
    }
    nodes.push(node);
  }
  flush();
  return segments;
}

/** Titles for a navigation UI; the prologue reads as `undefined`. */
export function segmentTitles(segments: readonly Segment[]): readonly (string | undefined)[] {
  return segments.map((s) => s.title);
}
