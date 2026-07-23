/**
 * verify/main.ts — THE MILESTONE-5 GATE harness. The spike beats programs,
 * bundled byte-for-byte unmodified, run SANDBOXED through the QuickJS host and
 * are played by the host-side player — the output must be visually + numerically
 * equivalent to milestone 4's in-process run.
 *
 * Sequence, per spike (mirrors M4 verify/main.ts, one layer down):
 *   1. create a fresh world + stage,
 *   2. bind them into a program scope,
 *   3. spin up a QuickJS context and marshal the scope members as guest globals,
 *   4. lint (author source) + evaluate the guest bundle — its top level IS the
 *      authoring pass; every M./lesson. call bridges to the real scope,
 *   5. play the resulting host-side timeline with the M3 player.
 *
 * Plus a DEGRADATION panel: a pathological guest program whose per-frame
 * closure diverges / divides by zero — the interrupt budget freezes/clamps the
 * frame and the program stays alive.
 *
 * `window.__ops` records the player's step feed (unchanged contract from M4)
 * so the screenshot driver can synchronize on named beats.
 */

import { createWorld } from '@math-ai/core';
import { createPlayer, createStage } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { QuickJSHost } from '../src/index.js';
import type { FrameStatus } from '../src/index.js';
// dist/guest-sources.js is emitted by build.mjs BEFORE this bundle is built.
import { AUTHOR_SOURCES, GUEST_SOURCES } from './dist/guest-sources.js';

type SpikeName = 'nerode' | 'ftc' | 'determinant';

/**
 * The numeric spot-checks the driver runs AFTER a program has played — read
 * back off the live, sandbox-authored world. These are the milestone-6 claims:
 * the shaded area really is the integral, and the determinant story's collapse
 * and sign flip really are emergent from the numbers.
 */
interface Probes {
  ftc(): { area: number; riemannTotal: number; limitGap: number; markerOnCurve: boolean };
  determinant(): { det: number; areaAt: Record<string, number> };
}

declare global {
  interface Window {
    __status: string;
    __ops: string[];
    __run(name: SpikeName): Promise<void>;
    __degrade(): Promise<void>;
    __probe: Probes;
    __degradeResult?: {
      statuses: FrameStatus[];
      values: number[];
      aliveAfter: boolean;
    };
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

const modulePromise = newQuickJSWASMModuleFromVariant(variant);

const started = new Set<SpikeName>();
const scopes = new Map<SpikeName, ReturnType<typeof createProgramScope>>();

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
    scopes.set(name, scope);

    const mod = await modulePromise;
    const ctx = mod.newContext();
    const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000, frameMs: 16 } });
    host.defineScope(scope as unknown as Record<string, unknown>);
    // the authoring pass, sandboxed + linted (author source scored, bundle run)
    host.run(GUEST_SOURCES[name], { lintSource: AUTHOR_SOURCES[name] });

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

// ─────────────────────── numeric spot-checks (probes) ───────────────────────

interface LiveNumber {
  readonly value: number;
  setValueLive?(next: number): void;
  readonly kind?: string;
}

function viewsOf(name: SpikeName, kind: string): unknown[] {
  const scope = scopes.get(name);
  if (!scope) throw new Error(`${name} has not run`);
  return scope.stage.views.filter((v) => v.kind === kind);
}

window.__probe = {
  ftc() {
    const region = viewsOf('ftc', 'view:region')[0] as { signedArea(): number };
    const riemann = viewsOf('ftc', 'view:riemann')[0] as { total(): number };
    const readout = viewsOf('ftc', 'view:readout')[0] as {
      values(): { value: number; gap?: number };
    };
    const plot = viewsOf('ftc', 'view:plot')[0] as {
      markerPositions(): ReadonlyArray<{ x: number; y: number }>;
    };
    const rule = (t: number): number => 0.5 * t + 1; // the spike's own f
    const markers = plot.markerPositions();
    return {
      area: region.signedArea(),
      riemannTotal: riemann.total(),
      limitGap: readout.values().gap ?? Number.NaN,
      markerOnCurve: markers.every((m) => Math.abs(m.y - rule(m.x)) < 1e-9),
    };
  },

  determinant() {
    const matrix = viewsOf('determinant', 'view:matrix')[0] as { elements: readonly LiveNumber[] };
    const region = viewsOf('determinant', 'view:region')[1] as { signedArea(): number };
    const entries = matrix.elements.filter((e) => e.kind === 'parameter');
    const [a, b, c, d] = entries as [LiveNumber, LiveNumber, LiveNumber, LiveNumber];
    const set = (p: LiveNumber, v: number): void => p.setValueLive?.(v);
    set(a, 2);
    set(b, 1);
    set(d, 1);

    const areaAt: Record<string, number> = {};
    set(c, 0);
    areaAt['c=0'] = region.signedArea(); //  det = 2
    set(c, 2);
    areaAt['c=2'] = region.signedArea(); //  det = 0 — the collapse
    set(c, 3);
    areaAt['c=3'] = region.signedArea(); //  det = -1 — orientation reversed
    set(c, 0);
    return { det: a.value * d.value - b.value * c.value, areaAt };
  },
};

// ─────────────────────────── degradation demo ───────────────────────────

const DEGRADE_PROGRAM = `
  runtime.onFrame(function (x) {
    if (x < 0) { var s = 0; while (true) { s = s + 1; } return s; }  // unbounded -> interrupt
    if (x === 0) return 1 / 0;    // Infinity -> clamp
    if (x === 42) return 0 / 0;   // NaN -> clamp
    return Math.round(x * x);     // good frame
  });
`;

const STATUS_LABEL: Record<FrameStatus, string> = {
  ok: 'OK',
  'frozen-interrupt': 'FROZEN (loop)',
  'frozen-throw': 'FROZEN (throw)',
  'clamped-nonfinite': 'CLAMPED (NaN/∞)',
};

window.__degrade = async (): Promise<void> => {
  const host = document.getElementById('degrade');
  if (!host) throw new Error('missing #degrade');
  host.innerHTML = '';

  let frameFn: ((x: number) => number) | null = null;
  const sink = {
    onFrame(f: (x: number) => number): void {
      frameFn = f;
    },
  };

  const mod = await modulePromise;
  const ctx = mod.newContext();
  const qhost = new QuickJSHost(ctx, {
    budget: { authorMs: 5000, frameMs: 12, maxTicks: 400_000 },
    lintGate: false, // the demo program is deliberately pathological
  });
  qhost.defineGlobal('runtime', sink);
  qhost.run(DEGRADE_PROGRAM);

  // A "drag": x sweeps through good frames and three pathological ones. The
  // last good value FREEZES through each bad frame; good frames resume after —
  // the program is never torn down.
  const path = [1, 2, 3, -1, 4, 0, 5, 42, 6, 7];
  const statuses: FrameStatus[] = [];
  const values: number[] = [];
  let last = 0;

  for (const x of path) {
    const r = qhost.frame(() => (frameFn ? frameFn(x) : NaN) as number, last);
    last = r.value;
    statuses.push(r.status);
    values.push(r.value);

    const cell = document.createElement('div');
    cell.className = `deg-cell deg-${r.status}`;
    cell.innerHTML =
      `<div class="deg-x">drag&nbsp;${x}</div>` +
      `<div class="deg-v">${r.value}</div>` +
      `<div class="deg-s">${STATUS_LABEL[r.status]}</div>`;
    host.appendChild(cell);
  }

  const aliveAfter = qhost.evalJSON<number>('1 + 1') === 2; // VM still usable
  window.__degradeResult = { statuses, values, aliveAfter };

  const summary = document.createElement('div');
  summary.className = 'deg-summary';
  summary.textContent = aliveAfter
    ? 'Program alive after 3 pathological frames — the drag never died.'
    : 'VM torn down (FAIL)';
  host.appendChild(summary);
  qhost.dispose();
};

// ─────────────────────────── wiring ───────────────────────────

document.getElementById('run-nerode')?.addEventListener('click', () => void window.__run('nerode'));
document.getElementById('run-ftc')?.addEventListener('click', () => void window.__run('ftc'));
document
  .getElementById('run-determinant')
  ?.addEventListener('click', () => void window.__run('determinant'));
document.getElementById('run-degrade')?.addEventListener('click', () => void window.__degrade());

if (new URLSearchParams(location.search).has('auto')) {
  void (async () => {
    await window.__run('nerode');
    await window.__run('ftc');
    await window.__run('determinant');
    await window.__degrade();
    window.__status = 'done:all';
  })();
}
