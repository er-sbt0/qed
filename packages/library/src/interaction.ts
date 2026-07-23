/**
 * interaction.ts — `Interaction.*`, the concrete affordances a program hands
 * to the student. Userland, like every discipline library: an interaction is
 * just a handle naming (what moves, along what), and the renderer wires the
 * pointer events for it.
 *
 * `Interaction.drag(x, {along: plot.xAxis})` is the FTC scrub beat. The policy
 * — the range x is clamped to — belongs to the Parameter, not here, so an
 * out-of-range drag is unreachable at the object boundary and no downstream
 * reactive numeric ever sees garbage.
 */

import type { Handle, World } from '@math-ai/core';
import type { Interaction, VarySettable } from '@math-ai/lesson';

export interface InteractionLib {
  drag(target: VarySettable, opts: { readonly along: Handle }): Interaction;
}

export function createInteraction(world: World): InteractionLib {
  return Object.freeze({
    drag(target: VarySettable, opts: { readonly along: Handle }): Interaction {
      const base = world.handle('interaction');
      // the rail represents the quantity it drives: hovering one lights both
      world.graph.record(base, target, 'represents', 'construction');
      return Object.freeze({
        id: base.id,
        kind: 'interaction' as const,
        mode: 'drag' as const,
        target,
        along: opts.along,
      });
    },
  });
}
