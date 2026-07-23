/**
 * view.seam.test.ts — the renderer backend seam (docs/renderer-backends.md,
 * step 1), checked by retrodiction: the existing SVG views satisfy
 * applyState/dispose/capabilities as they are, headless, in the cheap tier.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { World } from '@math-ai/core';
import type { VarySettable } from '@math-ai/lesson';
import { createStage } from './stage.js';
import type { Stage } from './stage.js';
import { View } from './view.js';
import { PlotView } from './views/plot.js';
import { RegionView } from './views/region.js';
import { StripView } from './views/strip.js';

function setup() {
  const world = createWorld();
  return { world, stage: createStage(world) };
}

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

const F = (x: number): number => 0.5 * x + 1;

/** A headless stage carrying one of each continuous family member. */
function framedTrio(stage: Stage, world: World): readonly View[] {
  const plot = new PlotView(stage, { subject: world.handle('fn'), sample: F, domain: [0, 6] });
  const region = new RegionView(stage, {
    mode: 'under',
    subject: world.handle('fn'),
    sample: F,
    from: 0,
    to: cell(world, 2),
  });
  const strip = new StripView(stage, {
    subject: world.handle('increment'),
    at: cell(world, 2),
    width: cell(world, 0.8),
    height: cell(world, F(2)),
    area: cell(world, 1.6),
    sample: F,
  });
  return [plot, region, strip];
}

describe('the backend seam, on the views that already exist', () => {
  it('the SVG family declares full capabilities — headless construction and per-element nodes', () => {
    const { world, stage } = setup();
    for (const v of framedTrio(stage, world)) {
      expect(v.capabilities).toEqual({ headlessConstruct: true, elementNodes: true });
    }
  });

  it('applyState is callable headless, synchronously, before any mount', () => {
    const { world, stage } = setup();
    framedTrio(stage, world);
    expect(() => stage.applyStateAll()).not.toThrow();
  });

  it('dispose is callable headless and idempotent — backward seek runs it constantly', () => {
    const { world, stage } = setup();
    framedTrio(stage, world);
    expect(() => stage.dispose()).not.toThrow();
    expect(() => stage.dispose()).not.toThrow();
  });

  it('Stage.dispose reaches every view, so a foreign backend cannot be skipped', () => {
    const { world, stage } = setup();
    const disposed: string[] = [];
    class Probe extends View {
      constructor(stage: Stage, tag: string) {
        super(stage, `probe:${tag}`);
      }
      protected render(): HTMLElement {
        throw new Error('headless');
      }
      override dispose(): void {
        disposed.push(this.kind);
      }
    }
    new Probe(stage, 'a');
    framedTrio(stage, world);
    new Probe(stage, 'b');
    stage.dispose();
    expect(disposed).toEqual(['probe:a', 'probe:b']);
  });
});
