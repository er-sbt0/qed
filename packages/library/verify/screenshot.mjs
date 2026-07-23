/**
 * verify/screenshot.mjs — THE PARITY GATE driver. Runs the engine-owned beats
 * program (bundled unmodified) in headless Chromium, synchronizes on the
 * player's step feed (`window.__ops`), captures screenshots at the key
 * beats, and asserts numeric/DOM spot-checks:
 *
 *   Nerode:  verdict table buildUp · cloud→buckets morph · machine with
 *            demonstrated edges · badge counts (6/6 ACCEPT/REJECT), 2
 *            buckets, 55 bucketed tokens, 4 inked edges, DISTINGUISHED.
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
    const n = await page.evaluate(
      ([wanted]) => window.__ops.filter((o) => o === wanted).length,
      [op],
    );
    if (n >= count) return;
    const status = await page.evaluate(() => window.__status);
    if (status?.startsWith('error:')) throw new Error(`beats failed: ${status}`);
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${count}× ${op} (have ${n})`);
    await sleep(100);
  }
}

const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console]', m.text());
    if (m.type() === 'warning') console.log('[console.warn]', m.text());
  });

  await page.goto(`${url}?speed=${SHOTS ? 5 : SPEED}`);

  // ═══ Myhill–Nerode ═══
  await page.evaluate(() => void window.__run('nerode'));

  await waitOps(page, 'nerode:reveal', 4); // mid-buildUp of the behavior table
  await shoot(page.locator('#nerode'), 'nerode-1-verdict-table.png');

  await waitOps(page, 'nerode:morph', 1); // cloud → buckets, tokens in flight
  await sleep(350);
  await shoot(page.locator('#nerode'), 'nerode-2-buckets-morph.png');

  await waitOps(page, 'nerode:demonstrate:event', 5); // edges inking in
  await shoot(page.locator('#nerode'), 'nerode-3-machine-edges.png');

  await waitDone(page, 'nerode');
  await shoot(page.locator('#nerode'), 'nerode-4-final.png');

  {
    const tableVerdicts = await page.$$eval('#nerode .mr-table .mr-verdict', (els) =>
      els.map((el) => el.textContent),
    );
    check('nerode: behavior table has 12 verdicts', tableVerdicts.length === 12, `${tableVerdicts.length}`);
    const accepts = tableVerdicts.filter((t) => t === 'ACCEPT').length;
    check('nerode: 6 ACCEPT / 6 REJECT in the table', accepts === 6, `${accepts} ACCEPT`);

    const expVerdicts = await page.$$eval('#nerode .mr-experiment .mr-verdict', (els) =>
      els.map((el) => el.textContent),
    );
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

    const edges = await page.$$eval('#nerode .mr-edge', (els) =>
      els.map((el) => el.classList.contains('mr-prehidden')),
    );
    check('nerode: 4 machine edges', edges.length === 4, `${edges.length}`);
    check('nerode: every edge inked in by its demonstration', edges.every((hidden) => !hidden));
  }

  await shoot(page, 'parity-full-page.png', { fullPage: true });

  console.log('\nscreenshots written to', out);
  if (failures.length > 0) {
    console.error(`\n${failures.length} spot-check(s) FAILED`);
    process.exit(1);
  }
  console.log('THE PARITY GATE: all spot-checks passed.');
} finally {
  await browser.close();
}
