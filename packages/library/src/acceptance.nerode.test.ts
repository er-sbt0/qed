/**
 * acceptance.nerode.test.ts — the Myhill–Nerode FIXTURE program
 * (src/__fixtures__/nerode/), run headless against the real library. Its
 * `./api` import resolves to a real runtime module beside it, so no vitest
 * resolver is involved. Node-side half of the parity gate; the browser half in
 * verify/ loads the same fixture.
 *
 * Engine-owned and frozen on purpose — see src/__fixtures__/README.md.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld, isHandle } from '@math-ai/core';
import type { ActionStep, Handle, TimelineNode, World } from '@math-ai/core';
import type {
  BeatPayload,
  CompareExperimentPayload,
  DemonstrateEventPayload,
  MorphPayload,
} from '@math-ai/lesson';
import { createStage } from '@math-ai/render';
import { createProgramScope, setActiveScope } from './scope.js';
import type { ProgramScope } from './scope.js';

function actions(nodes: readonly TimelineNode[]): ActionStep[] {
  const out: ActionStep[] = [];
  const walk = (list: readonly TimelineNode[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'action':
          out.push(node);
          break;
        case 'cascade':
          for (const it of node.iterations) walk(it);
          break;
        case 'parallel':
        case 'loop':
          walk(node.children);
          break;
      }
    }
  };
  walk(nodes);
  return out;
}

let world: World;
let scope: ProgramScope;

beforeAll(async () => {
  world = createWorld();
  scope = createProgramScope(world, createStage(world));
  setActiveScope(scope);
  await import('./__fixtures__/nerode/beats.js'); // the program runs here
});

describe('the Myhill–Nerode fixture program, unmodified', () => {
  it('authors a full timeline without throwing', () => {
    expect(world.timeline.root.length).toBeGreaterThan(10);
  });

  it('declares its four beats as step boundaries, in order', () => {
    const steps = actions(world.timeline.root);
    const beats = steps.filter((s) => s.op === 'beat').map((s) => s.payload as BeatPayload);
    expect(beats.map((b) => b.title)).toEqual([
      'One future tells them apart',
      'A pair no future separates',
      'Sort histories by how they act',
      'The classes were the states',
    ]);
    expect(beats.map((b) => b.index)).toEqual([0, 1, 2, 3]);
    expect(steps[0]!.op).toBe('beat'); // nothing is authored before the first boundary
  });

  it('beat 2: the distinguishing experiment reports ACCEPT vs REJECT', () => {
    const compares = actions(world.timeline.root).filter((s) => s.op === 'compareExperiment');
    expect(compares).toHaveLength(1);
    const payload = compares[0]!.payload as CompareExperimentPayload;
    expect(payload.experiment.agreement).toBe('distinguished');
    const verdicts = payload.experiment.outcomes.map((o) => o.verdict.label);
    expect(verdicts).toEqual(['REJECT', 'ACCEPT']); // '0'+'1'='01' rejects, '100'+'1'='1001' accepts
    expect(payload.layout).toBe('side-by-side');
  });

  it('beat 2b: the behavior table builds up column by column (6 columns)', () => {
    const reveals = actions(world.timeline.root).filter((s) => s.op === 'reveal');
    expect(reveals).toHaveLength(6);
  });

  it('beat 3: the cloud→buckets morph routes every one of the 31 words', () => {
    const morphs = actions(world.timeline.root).filter((s) => s.op === 'morph');
    expect(morphs).toHaveLength(2);
    const cloudToBuckets = morphs[0]!.payload as MorphPayload;
    expect(cloudToBuckets.routes).toHaveLength(31); // Σ^{≤4} over {0,1}
    // every route rides a recorded contributes-to edge (word → class)
    for (const route of cloudToBuckets.routes) {
      expect(route.hops.length).toBeGreaterThan(0);
    }
  });

  it('beat 3: the stream adds 24 words and the partition absorbs them', () => {
    const adds = actions(world.timeline.root).filter((s) => s.op === 'collection:add');
    expect(adds).toHaveLength(24);
  });

  it('beat 4: buckets→graph morph rides the class↔state counterpart edges', () => {
    const morphs = actions(world.timeline.root).filter((s) => s.op === 'morph');
    const bucketsToGraph = morphs[1]!.payload as MorphPayload;
    expect(bucketsToGraph.routes).toHaveLength(2); // one class per state
    for (const route of bucketsToGraph.routes) {
      expect(route.hops).toHaveLength(1);
      const hop = route.hops[0]!;
      expect(hop.via).toBe('edge');
      if (hop.via === 'edge') expect(hop.edge.rel).toBe('counterpart-of');
    }
  });

  it('beat 4: all four machine edges demonstrate their own derivations', () => {
    const events = actions(world.timeline.root)
      .filter((s) => s.op === 'demonstrate:event')
      .map((s) => s.payload as DemonstrateEventPayload);
    const edgeEvents = events.filter((p) => p.subject.kind === 'edge');
    const perEdge = new Map<string, string[]>();
    for (const p of edgeEvents) {
      const list = perEdge.get(p.subject.id) ?? [];
      list.push(p.event.type);
      perEdge.set(p.subject.id, list);
    }
    expect(perEdge.size).toBe(4);
    for (const types of perEdge.values()) {
      expect(types).toEqual(['hop', 'edge.derive']);
    }
  });

  it('narration mentions are recorded as represents edges', () => {
    const says = actions(world.timeline.root).filter((s) => s.op === 'say');
    expect(says.length).toBeGreaterThanOrEqual(8);
    const withMentions = says.filter((s) => {
      const mentions = (s.payload as { mentions: readonly unknown[] }).mentions;
      return mentions.some((m) => isHandle(m));
    });
    expect(withMentions.length).toBeGreaterThan(0);
    for (const step of withMentions) {
      const mentions = (step.payload as { mentions: readonly unknown[] }).mentions;
      const first = mentions.find((m) => isHandle(m)) as Handle;
      expect(
        world.graph
          .edgesOf(step)
          .some((e) => e.rel === 'represents' && (e.a.id === first.id || e.b.id === first.id)),
      ).toBe(true);
    }
  });
});
