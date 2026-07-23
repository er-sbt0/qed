/**
 * supersede.test.ts — the renderer-level decision on the M2 open question:
 * slot:set / collection:add DO supersede ambient loops, when connected to the
 * loop's subject by identity or one provenance hop.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { ActionStep, Handle } from '@math-ai/core';
import { stepSupersedesLoop } from './supersede.js';

interface Dist extends Handle<'distribution'> {
  readonly mass: number;
}

function setup() {
  const world = createWorld();
  const distOf = world.defineOp('dist.of', (ctx, mass: number): Dist =>
    ctx.value('distribution', { mass }),
  );
  const step = world.defineOp('chain.step', (ctx, d: Dist): Dist =>
    ctx.value('distribution', { mass: d.mass }),
  );
  return { world, distOf, step };
}

describe('stepSupersedesLoop', () => {
  it('a slot:set whose from-value is a provenance input of the loop subject supersedes it', () => {
    const { world, distOf, step } = setup();
    const pi = distOf(0.5);
    const flow = step(pi); // the ambient loop demonstrates this derived value
    const p0 = distOf(1);
    const slot = world.slot<Dist>(pi);
    const set = slot.set(p0, { via: 'fade' }) as ActionStep; // from = pi
    expect(stepSupersedesLoop(world, flow, set)).toBe(true);
  });

  it('a slot:set on an unrelated slot leaves the loop running', () => {
    const { world, distOf, step } = setup();
    const flow = step(distOf(0.5));
    const other = world.slot<Dist>(distOf(0.1));
    const set = other.set(distOf(0.2)) as ActionStep;
    expect(stepSupersedesLoop(world, flow, set)).toBe(false);
  });

  it('identity match supersedes without provenance', () => {
    const { world } = setup();
    const subject = world.handle('view:bars');
    const slot = world.slot<Handle>(subject);
    const set = slot.set(world.handle('view:bars')) as ActionStep; // from = subject
    expect(stepSupersedesLoop(world, subject, set)).toBe(true);
  });

  it('collection:add supersedes a loop demonstrating the collection (or its item)', () => {
    const { world } = setup();
    const words = world.collection<Handle>([]);
    const w = world.handle('word');
    const add = words.add(w) as ActionStep;
    expect(stepSupersedesLoop(world, words, add)).toBe(true);
    expect(stepSupersedesLoop(world, w, add)).toBe(true);
    expect(stepSupersedesLoop(world, world.handle('other'), add)).toBe(false);
  });

  it('non-mutation steps never supersede through this rule', () => {
    const { world, distOf, step } = setup();
    const flow = step(distOf(0.5));
    const say = world.timeline.step('say', {}) as ActionStep;
    expect(stepSupersedesLoop(world, flow, say)).toBe(false);
  });
});
