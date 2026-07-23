/**
 * verify/main.ts — THE PARITY GATE harness. Runs the engine-owned beats
 * program UNMODIFIED in a browser:
 *
 *   1. create a fresh world + stage,
 *   2. bind them into a program scope and make it active,
 *   3. dynamically import the beats module — its top level IS the program,
 *      and its `import ... from "./api"` is aliased (build.mjs) to the
 *      spike-api shim that re-exports the active scope,
 *   4. play the resulting timeline with the milestone-3 player.
 *
 * `window.__ops` records every timeline node the player starts, so the
 * screenshot driver can synchronize captures with named beats instead of
 * guessing at wall-clock offsets.
 */

import { createWorld } from '@math-ai/core';
import { createPlayer, createStage } from '@math-ai/render';
import { createProgramScope, setActiveScope } from '../src/index.js';

type SpikeName = 'nerode';

declare global {
  interface Window {
    __status: string;
    __ops: string[];
    __run(name: SpikeName): Promise<void>;
  }
}

function speedFromQuery(): number {
  const q = new URLSearchParams(location.search).get('speed');
  const n = q ? Number(q) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function container(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  el.innerHTML = '';
  return el;
}

const importers: Record<SpikeName, () => Promise<unknown>> = {
  // The engine-owned acceptance fixture (src/__fixtures__/nerode), the same
  // program the headless acceptance tests run — this gate is its browser half,
  // so it must load the same source, not whatever examples/ says today. The map
  // shape survives a single entry so adding a second fixture stays a one-liner.
  nerode: () => import('../src/__fixtures__/nerode/beats'),
};

const started = new Set<SpikeName>();

window.__status = 'ready';
window.__ops = [];
window.__run = async (name: SpikeName): Promise<void> => {
  if (started.has(name)) return; // a beats module body can only run once
  started.add(name);
  try {
    window.__status = `running:${name}`;
    const world = createWorld();
    const stage = createStage(world, container(name));
    const scope = createProgramScope(world, stage);
    setActiveScope(scope);
    await importers[name](); // the program runs here (authoring pass)
    const player = createPlayer(stage, scope.lesson, {
      speed: speedFromQuery(),
      onStep: (node) => {
        window.__ops.push(`${name}:${node.type === 'action' ? node.op : node.type}`);
      },
    });
    await player.play();
    window.__status = `done:${name}`;
  } catch (error) {
    window.__status = `error:${name}:${(error as Error).message}`;
    throw error;
  }
};

document.getElementById('run-nerode')?.addEventListener('click', () => void window.__run('nerode'));

if (new URLSearchParams(location.search).has('auto')) {
  void (async () => {
    await window.__run('nerode');
    window.__status = 'done:all';
  })();
}
