/**
 * perf.test.ts — the performance-tiering claim (architecture "Performance
 * tiering"): structure/semantics closures cross the sandbox boundary; hot
 * numeric inner loops stay HOST-NATIVE, with only their inputs crossing. This
 * measures the split and prints it (loose asserts only — informative, not
 * flaky).
 *
 * What is NOT measured here any more: a whole authoring pass, end to end. That
 * case bundled a frozen lesson fixture to get a stable millisecond budget, and
 * the fixture is gone on purpose — no lesson content is pinned in this repo, so
 * there is nothing left whose op count stays put across a prompt or vocabulary
 * change. A pass timed against churning content is a number that means nothing.
 * The two claims below need no program at all: they are measured against the
 * library and the bridge directly, which is where the tiering actually lives.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createProbability } from '@math-ai/library';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';

describe('performance tiering: closures cross, hot numerics stay host-native', () => {
  it('a Prob.stationary recompute is host-native: power iteration crosses the boundary ZERO times', async () => {
    // Prob.stationary lives in host library code. Only its *inputs* (the chain)
    // ever cross; the power-iteration inner loop is native TS. We prove this by
    // running stationary purely in-process (as the runtime's fast path does)
    // and confirming it needs no VM at all — then contrast with the per-call
    // bridge cost a naive in-guest implementation would pay per iteration.
    const world = createWorld();
    const Prob = createProbability(world);
    const states = Prob.states(['Sunny', 'Cloudy', 'Rainy']);
    const P = Prob.stochasticMatrix({
      states,
      values: [
        [0.7, 0.2, 0.1],
        [0.3, 0.4, 0.3],
        [0.2, 0.3, 0.5],
      ],
      editable: 'renormalize-row',
    });
    const chain = Prob.markovChain({ states, transitions: P });
    const pi = Prob.stationary(chain);

    // Simulate a 200-frame drag: each frame edits a cell and re-reads π. This is
    // the interaction path — entirely host-native, no sandbox involved.
    const cell = P.cell('Sunny', 'Sunny');
    const t0 = performance.now();
    const FRAMES = 200;
    for (let f = 0; f < FRAMES; f += 1) {
      cell.setValue?.(0.5 + 0.4 * Math.sin(f)); // renormalize-row keeps it stochastic
      // reading a mass re-runs power iteration over the fresh matrix, host-native
      void states.items.map((s) => pi.mass(s));
    }
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[perf] 200 host-native stationary recomputes (drag path): ${ms.toFixed(1)}ms ` +
        `(${(ms / FRAMES).toFixed(3)}ms/frame) — ZERO sandbox crossings on the hot loop`,
    );
    expect(ms / FRAMES).toBeLessThan(5); // comfortably inside a 16ms frame budget
  });

  it('a single guest closure round-trip is sub-millisecond', async () => {
    const ctx = await newNodeContext();
    const host = new QuickJSHost(ctx, { budget: { authorMs: 5000 }, lintGate: false });
    const holder: { fn: ((x: number) => number) | null } = { fn: null };
    host.defineGlobal('runtime', { onFrame: (f: (x: number) => number) => { holder.fn = f; } });
    host.run('runtime.onFrame(function (x) { return x + 1; });');
    const fn = holder.fn;
    if (!fn) throw new Error('frame fn not registered');
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) fn(i);
    const per = (performance.now() - t0) / N;
    // eslint-disable-next-line no-console
    console.log(`[perf] guest closure round-trip: ${(per * 1000).toFixed(1)}µs/call`);
    expect(per).toBeLessThan(1); // < 1ms per host→guest→host round trip
    host.dispose();
  });
});
