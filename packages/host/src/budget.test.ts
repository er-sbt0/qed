/**
 * budget.test.ts — the interaction-time-failure proof. A guest closure sits on
 * the per-frame path; we throw pathological frames at it and show the host
 * degrades (freeze / clamp) and the program SURVIVES — the drag never dies.
 */
import { describe, expect, it } from 'vitest';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';

/**
 * A tiny "runtime" host object the guest program registers a per-frame
 * computation with. This stands in for the reactive derived value the runtime
 * re-invokes each frame when a guest closure sits on the interaction path.
 */
function frameSink() {
  let fn: ((x: number) => number) | null = null;
  return {
    obj: {
      onFrame(f: (x: number) => number): void {
        fn = f;
      },
    },
    call(x: number): number {
      if (!fn) throw new Error('no frame fn registered');
      return fn(x);
    },
  };
}

async function makeHost() {
  const ctx = await newNodeContext();
  // small per-frame budget so an unbounded loop trips it fast
  return new QuickJSHost(ctx, { budget: { frameMs: 20, authorMs: 5000, maxTicks: 200_000 }, lintGate: false });
}

describe('interrupt budget / graceful degradation', () => {
  it('freezes on an unbounded-loop frame, clamps NaN, and keeps the program alive', async () => {
    const host = await makeHost();
    const sink = frameSink();
    host.defineGlobal('runtime', sink.obj);

    // A pathological per-frame closure: it diverges when x < 0, divides by zero
    // when x === 0, and is well-behaved otherwise.
    host.run(`
      runtime.onFrame(function (x) {
        if (x < 0) { while (true) {} }      // unbounded loop -> interrupt
        if (x === 0) return 1 / 0;          // Infinity -> clamp
        if (x === 99) return 0 / 0;         // NaN -> clamp
        return x * 2;                       // good frame
      });
    `);

    let last = 42; // last good frame
    const trace: Array<{ x: number; status: string; degraded: boolean; value: number }> = [];
    const drive = (x: number) => {
      const r = host.frame(() => sink.call(x) as number, last);
      last = r.value;
      trace.push({ x, status: r.status, degraded: r.degraded, value: r.value });
      return r;
    };

    drive(5); // ok -> 10
    drive(-1); // unbounded loop -> frozen-interrupt, keeps 10
    drive(7); // recovers -> 14 (program NOT torn down)
    drive(0); // divide-by-zero -> Infinity -> clamped to 14
    drive(99); // NaN -> clamped to 14
    drive(3); // ok again -> 6

    expect(trace.map((t) => t.status)).toEqual([
      'ok',
      'frozen-interrupt',
      'ok',
      'clamped-nonfinite',
      'clamped-nonfinite',
      'ok',
    ]);
    expect(trace.map((t) => t.value)).toEqual([10, 10, 14, 14, 14, 6]);

    // The VM is still fully usable after all that — the sandbox was not torn down.
    expect(host.evalJSON<number>('1 + 1')).toBe(2);
    host.dispose();
  });

  it('an unbounded loop in the AUTHORING pass is caught by the budget, not a hang', async () => {
    const ctx = await newNodeContext();
    const host = new QuickJSHost(ctx, { budget: { authorMs: 50 }, lintGate: false });
    const t0 = Date.now();
    expect(() => host.run('while (true) {}')).toThrow(/interrupt/i);
    expect(Date.now() - t0).toBeLessThan(2000); // did not hang
    host.dispose();
  });
});
