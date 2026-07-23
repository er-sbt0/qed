/**
 * loop-scene.ts — the instrumented spin scene, shared by every loop tier.
 *
 * One scene, three consumers: loop.sandbox.test.ts proves the assembly over it
 * with a scripted model; record-loop.test.ts drives a REAL model over it (the
 * billed 4c exit recording); loop-replay.test.ts refolds it to re-execute a
 * recorded turn's tools for free. The builder must be the same object in all
 * three — a cassette replays its tools against a freshly folded scene, and a
 * private copy of the scene in each file is how a replay quietly ends up
 * running against a world the recording never saw.
 *
 * Test machinery, not product: index.ts does not export this, and the heavy
 * imports (core, library, render, host/node) are planner devDependencies.
 */

import { createWorld } from '@math-ai/core';
import { createStage, sceneIndex, type Stage } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost, isolate, replayLog, runTool } from '@math-ai/host';
import type {
  CompileFragment,
  ConversationLog,
  FoldScene,
  SceneMap,
  Settable,
} from '@math-ai/host';
import { newNodeContext } from '@math-ai/host/node';
import { compileFragment } from './compile.js';
import type { ToolExecutor } from './loop.js';

/**
 * The scene as 2·spin ≤ 3: a draggable parameter, a derived value, and a claim
 * whose verdict flips at spin = 1.5 — the same instrument
 * tools.sandbox.test.ts plays. The flip threshold appears in NO snapshot; only
 * a probe (bisectFlip, counterfactual) can name it, which is what makes this
 * scene the right one for "why did that turn red?".
 */
export const SPIN_PROGRAM = [
  'const spin = M.parameter("spin", 1, { range: [-2, 2] });',
  'const doubled = M.derived(() => 2 * spin.value, "doubled");',
  'const under = M.claim({ lhs: doubled, rhs: 3, relation: "<=", label: "under three" });',
  'lesson.beat("An instrument");',
  'lesson.expose(spin, { as: "draggable" });',
  'lesson.show(View.readout(doubled, { label: "doubled" }));',
  'lesson.show(View.claim(under));',
].join('\n');

export interface LoopScene {
  readonly world: ReturnType<typeof createWorld>;
  readonly stage: Stage;
  readonly scope: ReturnType<typeof createProgramScope>;
  readonly host: QuickJSHost;
  readonly execute: (entry: { js: string }) => void;
}

export async function freshScene(): Promise<LoopScene> {
  const world = createWorld();
  const stage = createStage(world);
  const scope = createProgramScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  const execute = (entry: { js: string }): void => {
    host.run(isolate(entry.js));
  };
  return { world, stage, scope, host, execute };
}

/** Every fold is a brand-new VM replaying the candidate — state = fold(log). */
export const fold: FoldScene = async (candidate: ConversationLog) => {
  const s = await freshScene();
  const result = replayLog(candidate, {
    execute: s.execute,
    resolve: (id) => sceneIndex(s.stage).get(id) as Settable | undefined,
  });
  return result.ok ? { ok: true, scene: sceneIndex(s.stage) } : result;
};

/** The REAL 4b gate as the compile hook: esbuild strip + lint, via planner. */
export const compile: CompileFragment = async (source) => {
  const result = await compileFragment(source);
  return result.ok
    ? { ok: true, js: result.program.js }
    : { ok: false, errors: result.errors };
};

/**
 * A LIVE scene with `log` already applied, in order — program, fragments, and
 * the student's set-input events alike. What the recorder points the executor
 * at, and what replay rebuilds from a stored cassette's log.
 */
export async function sceneFromLog(log: ConversationLog): Promise<LoopScene> {
  const s = await freshScene();
  const result = replayLog(log, {
    execute: s.execute,
    resolve: (id) => sceneIndex(s.stage).get(id) as Settable | undefined,
  });
  if (!result.ok) {
    throw new Error(
      `the log does not fold: [${result.failure.index}] (${result.failure.kind}) ${result.failure.message}`,
    );
  }
  return s;
}

export function idByLabel(scene: SceneMap, label: string, kind?: string): string {
  for (const h of scene.values()) {
    if ((h as { label?: unknown }).label === label && (kind === undefined || h.kind === kind)) {
      return h.id;
    }
  }
  throw new Error(`nothing labeled "${label}" in the scene`);
}

/** The only legal executor: host's runTool over sceneIndex, hooks per call. */
export function executorFor(stage: Stage): ToolExecutor {
  return (call, log) =>
    runTool(call, { scene: () => sceneIndex(stage), log, fold, compile });
}
