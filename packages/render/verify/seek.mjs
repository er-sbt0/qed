/**
 * verify/seek.mjs — THE FAST-FORWARD GATE.
 *
 * A fast-forward is only useful if the stage it leaves behind is the stage the
 * student would have seen had they watched every beat. So for each demo and a
 * chosen beat k, this driver runs the SAME demo twice in headless Chromium:
 *
 *   A — `__stepTo(n, k)`: play beats 0..k one at a time, animation and all.
 *   B — `__seekTo(n, k)`: a FRESH world, beats 0..k-1 fast-forwarded silently
 *       (`Player.seek`), then beat k played normally.
 *
 * It screenshots both (so they can be eyeballed side by side) and compares a
 * structural snapshot of the stage — narration text, visible views, bar
 * values, matrix cells, chip counts, revealed/pre-hidden parts. Transient
 * animation classes (`mr-lit`, in-flight travelers) are excluded: those differ
 * frame to frame even between two identical runs.
 *
 *   node verify/seek.mjs [outDir]
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromiumPath, parseFlags } from '../../../scripts/verify/driver.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + join(here, '..', 'demo', 'dist', 'index.html');
const { shots: SHOTS, speed: SPEED, out: outArg } = parseFlags();
const out = resolve(outArg ?? join(here, 'shots-seek'));
// The A/B images are for eyeballing; the structural comparison is the gate.
if (SHOTS) mkdirSync(out, { recursive: true });
/** Capture `name` from a page or locator — a no-op without --shots. */
const shoot = async (target, name, opts) =>
  SHOTS ? target.screenshot({ path: join(out, name), ...opts }) : undefined;

const executablePath = chromiumPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

/** A structural snapshot of a demo's stage, free of transient animation state. */
const SNAPSHOT = (id) => {
  const host = document.getElementById(id);
  if (!host) return { missing: true };
  const visible = (el) => !el.classList.contains('mr-hidden') && !el.closest('.mr-hidden');
  const txt = (sel) => [...host.querySelectorAll(sel)].map((el) => el.textContent.trim());
  return {
    narration: txt('.mr-narration p, .mr-narration li'),
    views: [...host.querySelectorAll('.mr-view')].map((el) => `${el.className.replace(/mr-lit|mr-emph-\w+|mr-measuring/g, '').trim()}:${visible(el)}`),
    bars: [...host.querySelectorAll('.mr-bars')].map((g) =>
      [...g.querySelectorAll('.mr-bar-value')].map((el) => el.textContent),
    ),
    barHeights: [...host.querySelectorAll('.mr-bar')].map((el) => el.style.height),
    matrix: txt('.mr-matrix td'),
    tokens: host.querySelectorAll('.mr-token').length,
    buckets: host.querySelectorAll('.mr-bucket').length,
    bucketChips: host.querySelectorAll('.mr-bucket-members .mr-token').length,
    verdicts: txt('.mr-verdict'),
    prehidden: host.querySelectorAll('.mr-prehidden').length,
    edges: host.querySelectorAll('.mr-edge').length,
    formulas: txt('.mr-view [data-mr-role]'),
    strip: [...host.querySelectorAll('.mr-strip-rect')].map(
      (el) => `${el.getAttribute('x')}/${el.getAttribute('width')}/${el.getAttribute('height')}`,
    ),
    readouts: txt('.mr-readout-value, .mr-readout-compare, .mr-readout-gap'),
    history: [...host.querySelectorAll('.mr-history .mr-series')].map((el) =>
      (el.getAttribute('d') ?? '').split(/[ML]/).length,
    ),
  };
};

async function waitAt(page, n, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    const status = await page.evaluate(() => window.__status);
    if (status?.startsWith(`at:${n}:`)) return status;
    if (status?.startsWith('error:')) throw new Error(status);
    if (Date.now() - t0 > timeout) throw new Error(`timeout (at ${status})`);
    await sleep(150);
  }
}

const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console]', m.text());
  });
  await page.goto(`${url}?speed=${SHOTS ? 6 : SPEED}`);

  // demo, beat to land on, label
  const cases = [
    { n: 1, k: 3, name: 'collapse' }, // after the morph + the stream cascade
    // beat 4 starts AFTER the ambient equilibrium loop (beat 3) and BEFORE the
    // slot:set that supersedes it (beat 5): the loop must be breathing on
    // arrival, having been started by the fast-forward's deferred path.
    { n: 3, k: 4, name: 'equilibrium', ambient: true },
    { n: 3, k: 5, name: 'stationarity', ambient: false }, // superseded while skipping
    // the continuous path: a live-reading strip whose Δx was varied in a
    // skipped beat, and a formula transformed in the beat being played.
    { n: 4, k: 3, name: 'strip' },
  ];

  /** Is anything still animating ambiently? Sample the travelers over a window. */
  async function ambientAlive(page, ms = 2000) {
    let seen = 0;
    for (let i = 0; i < ms / 100; i += 1) {
      seen += await page.evaluate(() => document.querySelectorAll('.mr-traveler').length);
      await sleep(100);
    }
    return seen;
  }

  for (const { n, k, name, ambient } of cases) {
    const titles = await page.evaluate((d) => window.__titles(d), n);
    console.log(`\n── demo ${n} (${name}) — ${titles.length} beats: ${titles.join(' · ')}`);
    console.log(`   landing on beat ${k}: "${titles[k]}"`);

    await page.evaluate(([d, i]) => void window.__stepTo(d, i), [n, k]);
    await waitAt(page, n);
    await sleep(600); // let the boundary settle (transient classes expire)
    const stepped = await page.evaluate(SNAPSHOT, `demo${n}`);
    await shoot(page.locator(`#demo${n}`), `${name}-A-stepped.png`);

    await page.evaluate(([d, i]) => void window.__seekTo(d, i), [n, k]);
    await waitAt(page, n);
    await sleep(600);
    const seeked = await page.evaluate(SNAPSHOT, `demo${n}`);
    await shoot(page.locator(`#demo${n}`), `${name}-B-seeked.png`);

    if (ambient !== undefined) {
      // D: parked at a boundary, the picture keeps breathing — unless the
      // skipped beats superseded the loop.
      const alive = await ambientAlive(page);
      check(
        `demo ${n} · ambient loop ${ambient ? 'still breathing' : 'stopped'} after seeking to beat ${k}`,
        ambient ? alive > 0 : alive === 0,
        `${alive} traveler samples`,
      );
    }

    for (const key of Object.keys(stepped)) {
      const a = JSON.stringify(stepped[key]);
      const b = JSON.stringify(seeked[key]);
      check(`demo ${n} · ${key} identical after seek`, a === b, a === b ? undefined : `stepped ${a}\n        seeked  ${b}`);
    }
  }

  console.log('\nscreenshots written to', out);
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log('FAST-FORWARD GATE: a seeked stage matches a stepped stage.');
} finally {
  await browser.close();
}
