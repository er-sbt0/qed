/**
 * stateGraph.test.ts — the graph view's LIVE re-reads, model-level and
 * headless (no DOM): `edgeLabel` and `edgeEmphasis` are spec functions the
 * view re-invokes, so a weight backed by a dragged Parameter repaints its
 * label and flips its tree-membership emphasis with no authored sync.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { Handle, World } from '@math-ai/core';
import type { VarySettable } from '@math-ai/lesson';
import { createStage } from '../stage.js';
import { StateGraphView } from './stateGraph.js';
import type { GraphEdgeLike } from './stateGraph.js';

/** A minimal live scalar with the interaction hook, standing in for a Parameter. */
function cell(world: World, initial: number): VarySettable & { setValueLive(next: number): void } {
  const slot = world.slot(initial);
  const base = world.handle('scalar');
  return {
    id: base.id,
    kind: 'scalar',
    get value(): number {
      return slot.value;
    },
    setValue(next: number): void {
      slot.set(next);
    },
    setValueLive(next: number): void {
      slot.poke(next);
    },
  };
}

interface WeightedEdge extends GraphEdgeLike {
  readonly weight: number;
}

function setup() {
  const world = createWorld();
  const stage = createStage(world);
  const node = (label: string): Handle & { label: string } => ({ ...world.handle('node'), label });
  const a = node('A');
  const b = node('B');
  const c = node('C');
  const w = cell(world, 5);
  const edges: readonly WeightedEdge[] = [
    Object.freeze({
      ...world.handle('edge'),
      from: a,
      to: b,
      get weight(): number {
        return w.value; // the live-weight shape graph.ts builds
      },
    }),
    Object.freeze({ ...world.handle('edge'), from: b, to: c, weight: 2 }),
  ];
  const view = new StateGraphView<WeightedEdge>(stage, {
    states: [a, b, c],
    edges,
    edgeLabel: (e) => String(e.weight),
    // stands in for LiveSpanningTree.inTree — any live predicate over weights
    edgeEmphasis: (e) => e.weight < 4,
    directed: false,
  });
  return { world, stage, view, w };
}

describe('StateGraphView live re-reads', () => {
  it('edge labels re-read the live weight; emphasis re-reads the live predicate', () => {
    const { view, w } = setup();
    expect(view.edgeStates()).toEqual([
      { id: expect.any(String), label: '5', inTree: false },
      { id: expect.any(String), label: '2', inTree: true },
    ]);
    w.setValueLive(1); // the drag path — no timeline step
    expect(view.edgeStates()).toEqual([
      { id: expect.any(String), label: '1', inTree: true },
      { id: expect.any(String), label: '2', inTree: true },
    ]);
  });

  it('applyState is callable headless before any mount (the seam contract)', () => {
    const { stage } = setup();
    expect(() => stage.applyStateAll()).not.toThrow();
  });

  it('declares full SVG capabilities — headless construction, per-element nodes', () => {
    const { view } = setup();
    expect(view.capabilities).toEqual({ headlessConstruct: true, elementNodes: true });
  });
});
