/**
 * verify/screenshot.mjs — THE MILESTONE-5 GATE driver. Runs the spike beats
 * programs (bundled unmodified) SANDBOXED through the QuickJS host in headless
 * Chromium, synchronizes on the player's step feed (`window.__ops`), captures
 * screenshots at the same key beats M4 used, and asserts the SAME numeric/DOM
 * spot-checks the milestone-4 in-process run asserted — passing M4's own gate
 * on the QuickJS run is the equivalence proof. Then it drives the degradation
 * panel and proves the drag survives pathological frames.
 *
 *   node verify/screenshot.mjs [outDir]
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromiumPath, parseFlags } from '../../../scripts/verify/driver.mjs';

const require = createRequire(import.meta.url);
const pw = require('playwright-core');
const { chromium } = pw;

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + join(here, 'dist', 'index.html');
const { shots: SHOTS, speed: SPEED, out: outArg } = parseFlags();
const out = resolve(outArg ?? join(here, 'shots'));
// Images are opt-in; the spot-checks below are what the gate is for.
if (SHOTS) mkdirSync(out, { recursive: true });
/** Capture `name` from a page or locator — a no-op without --shots. */
const shoot = async (target, name, opts) =>
  SHOTS ? target.screenshot({ path: join(out, name), ...opts }) : undefined;

const executablePath = chromiumPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(label, ok, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  if (!ok) failures.push(line);
}

async function waitDone(page, name, timeout = 180000) {
  const t0 = Date.now();
  for (;;) {
    const status = await page.evaluate(() => window.__status);
    if (status === `done:${name}`) return;
    if (status?.startsWith('error:')) throw new Error(`beats failed: ${status}`);
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for done:${name} (at ${status})`);
    await sleep(200);
  }
}

async function waitOps(page, op, count, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    const n = await page.evaluate(([wanted]) => window.__ops.filter((o) => o === wanted).length, [op]);
    if (n >= count) return;
    const status = await page.evaluate(() => window.__status);
    if (status?.startsWith('error:')) throw new Error(`beats failed: ${status}`);
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${count}× ${op} (have ${n})`);
    await sleep(100);
  }
}

const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1180 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console]', m.text());
  });

  await page.goto(`${url}?speed=${SHOTS ? 5 : SPEED}`);

  // ═══ Myhill–Nerode — same beats + spot-checks as M4, now sandboxed ═══
  await page.evaluate(() => void window.__run('nerode'));

  await waitOps(page, 'nerode:reveal', 4);
  await shoot(page.locator('#nerode'), 'nerode-1-verdict-table.png');

  await waitOps(page, 'nerode:morph', 1);
  await sleep(350);
  await shoot(page.locator('#nerode'), 'nerode-2-buckets-morph.png');

  await waitOps(page, 'nerode:demonstrate:event', 5);
  await shoot(page.locator('#nerode'), 'nerode-3-machine-edges.png');

  await waitDone(page, 'nerode');
  await shoot(page.locator('#nerode'), 'nerode-4-final.png');

  {
    const tableVerdicts = await page.$$eval('#nerode .mr-table .mr-verdict', (els) => els.map((el) => el.textContent));
    check('nerode: behavior table has 12 verdicts', tableVerdicts.length === 12, `${tableVerdicts.length}`);
    const accepts = tableVerdicts.filter((t) => t === 'ACCEPT').length;
    check('nerode: 6 ACCEPT / 6 REJECT in the table', accepts === 6, `${accepts} ACCEPT`);

    const expVerdicts = await page.$$eval('#nerode .mr-experiment .mr-verdict', (els) => els.map((el) => el.textContent));
    check(
      'nerode: distinguishing experiment shows ACCEPT vs REJECT',
      expVerdicts.length === 2 && expVerdicts.includes('ACCEPT') && expVerdicts.includes('REJECT'),
      expVerdicts.join('/'),
    );
    const banner = await page.$eval('#nerode .mr-agreement', (el) => el.textContent);
    check('nerode: experiment banner DISTINGUISHED', banner === 'DISTINGUISHED', banner);

    const buckets = await page.$$eval('#nerode .mr-bucket', (els) => els.length);
    check('nerode: exactly 2 buckets (no third ever appears)', buckets === 2, `${buckets}`);
    const chips = await page.$$eval('#nerode .mr-bucket-members .mr-token', (els) => els.length);
    check('nerode: 55 words bucketed (31 enumerated + 24 streamed)', chips === 55, `${chips}`);

    const edges = await page.$$eval('#nerode .mr-edge', (els) => els.map((el) => el.classList.contains('mr-prehidden')));
    check('nerode: 4 machine edges', edges.length === 4, `${edges.length}`);
    check('nerode: every edge inked in by its demonstration', edges.every((hidden) => !hidden));
  }

  // ═══ FTC — the milestone-6 continuous story, sandboxed ═══
  await page.evaluate(() => void window.__run('ftc'));

  await waitOps(page, 'ftc:show', 2);
  await sleep(400);
  await shoot(page.locator('#ftc'), 'ftc-1-accumulator.png');

  await waitOps(page, 'ftc:transformFormula', 1);
  await sleep(500);
  await shoot(page.locator('#ftc'), 'ftc-2-formula-morph.png');

  await waitOps(page, 'ftc:demonstrate:event', 4);
  await shoot(page.locator('#ftc'), 'ftc-3-riemann.png');

  await waitDone(page, 'ftc');
  await shoot(page.locator('#ftc'), 'ftc-4-final.png');

  {
    const curves = await page.$$eval('#ftc .mr-curve', (els) => els.map((el) => (el.getAttribute('d') ?? '').length));
    check('ftc: both plots drew a curve (f and A)', curves.length === 2 && curves.every((n) => n > 100), `${curves.length} curves`);

    const filled = await page.$eval('#ftc .mr-fill', (el) => (el.getAttribute('d') ?? '').length > 100);
    check('ftc: the region under f is shaded', filled);

    const rects = await page.$$eval('#ftc .mr-riemann-rect', (els) => els.map((el) => el.classList.contains('mr-prehidden')));
    check('ftc: 8 Riemann rectangles', rects.length === 8, `${rects.length}`);
    check('ftc: every rectangle inked in by its demonstration', rects.every((hidden) => !hidden));

    const p = await page.evaluate(() => window.__probe.ftc());
    // f(t) = 0.5t + 1, x = 2  ⇒  ∫₀² f = 3, exactly
    check('ftc: shaded area = ∫₀² f = 3 (area ≈ ∫)', Math.abs(p.area - 3) < 0.01, `area = ${p.area.toFixed(4)}`);
    check('ftc: the 8 midpoint rectangles sum to the same 3', Math.abs(p.riemannTotal - 3) < 1e-6, `Σ = ${p.riemannTotal.toFixed(6)}`);
    check('ftc: after Δx → 0.005, ΔA/Δx has closed on f(x)', Math.abs(p.limitGap) < 0.005, `gap = ${p.limitGap.toExponential(2)}`);
    check('ftc: every moving point sits ON its curve', p.markerOnCurve === true);

    const gapConverged = await page.$$eval('#ftc .mr-readout-gap .mr-converged', (els) => els.length);
    check('ftc: the readout marks the gap as converged', gapConverged === 1, `${gapConverged}`);
  }

  // ═══ Determinant — emergent collapse and orientation, sandboxed ═══
  await page.evaluate(() => void window.__run('determinant'));

  await waitOps(page, 'determinant:morph', 1);
  await sleep(600);
  await shoot(page.locator('#determinant'), 'det-1-square-to-parallelogram.png');

  await waitOps(page, 'determinant:vary', 1);
  await sleep(400);
  await shoot(page.locator('#determinant'), 'det-2-collapse.png');

  await waitOps(page, 'determinant:vary', 2);
  await sleep(400);
  await shoot(page.locator('#determinant'), 'det-3-sign-flip.png');

  await waitDone(page, 'determinant');
  await shoot(page.locator('#determinant'), 'det-4-final.png');

  {
    const grid = await page.$$eval('#determinant .mr-gridline', (els) => els.length);
    check('determinant: the transformed lattice drew its grid', grid > 8, `${grid} lines`);

    const p = await page.evaluate(() => window.__probe.determinant());
    check('determinant: det = ad − bc = 2 at the authored matrix', Math.abs(p.det - 2) < 1e-9, `det = ${p.det}`);
    // NOTHING in the program tests for these conditions — the region is the
    // reactive image of the live matrix, and its fill is keyed to signed area
    check('determinant: |det| IS the area ratio (unit square ⇒ area = det)', Math.abs(p.areaAt['c=0'] - 2) < 1e-9, `area = ${p.areaAt['c=0']}`);
    check('determinant: det → 0 COLLAPSES the parallelogram (emergent)', Math.abs(p.areaAt['c=2']) < 1e-9, `area = ${p.areaAt['c=2']}`);
    check('determinant: det < 0 FLIPS the orientation (emergent)', Math.abs(p.areaAt['c=3'] + 1) < 1e-9, `area = ${p.areaAt['c=3']}`);
  }

  // ═══ Degradation — the interrupt budget on the frame path ═══
  await page.evaluate(() => window.__degrade());
  await shoot(page.locator('#degrade'), 'degrade-frames.png');
  {
    const r = await page.evaluate(() => window.__degradeResult);
    check('degrade: pathological frames degraded, good frames stayed ok', !!r &&
      JSON.stringify(r.statuses) === JSON.stringify([
        'ok', 'ok', 'ok', 'frozen-interrupt', 'ok', 'clamped-nonfinite', 'ok', 'clamped-nonfinite', 'ok', 'ok',
      ]), r && r.statuses.join(','));
    check('degrade: last-good value froze through bad frames (values monotone-sane)', !!r &&
      JSON.stringify(r.values) === JSON.stringify([1, 4, 9, 9, 16, 16, 25, 25, 36, 49]), r && r.values.join(','));
    check('degrade: program still alive after 3 pathological frames (drag never died)', !!r && r.aliveAfter === true);
  }

  await shoot(page, 'gate-full-page.png', { fullPage: true });

  console.log('\nscreenshots written to', out);
  if (failures.length > 0) {
    console.error(`\n${failures.length} spot-check(s) FAILED`);
    process.exit(1);
  }
  console.log('THE GATE: all spot-checks passed (M4 parity + FTC + determinant + degradation).');
} finally {
  await browser.close();
}
