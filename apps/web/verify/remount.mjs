/**
 * verify/remount.mjs — mount every example program in a real browser. Free.
 *
 * `screenshot.mjs` walks ONE example very deeply — by default the newest
 * recording: seek, rebuild parity, arrow keys, replay, theme. That is the right
 * shape for proving the HOST, because those are host properties and one lesson
 * exercises them.
 *
 * What it does not prove is that the OTHER examples still render. They are
 * prompt input — `examples/` is recorded model output, replaced wholesale by
 * `./run.sh record`, and re-recording it is often the highest-leverage change
 * available — so a free check that every one still mounts, plays and draws is
 * the feedback loop that a re-record needs. The unit
 * tier (`examples.smoke.test.ts`) runs them through QuickJS against a headless
 * stage: that proves they gate and execute, and says nothing about SVG, KaTeX,
 * the wasm variant or the player. This says the rest.
 *
 *   ./run.sh remount [--only=key,key] [--shots]
 *
 * It mounts through `/playground`, which is also the only gate that covers that
 * route and its `window.__mount` hand-off.
 *
 * The programs come from `EXAMPLE_PROGRAMS` — the same inlined, import-stripped
 * `js` the app's gallery runs — so this reads no lesson files and needs no
 * compile step of its own. A private esbuild pass here would prove something
 * about THIS script rather than about what ships.
 */
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';

import {
  createChecker,
  createTimer,
  launchBrowser,
  parseFlags,
  serveOn,
  sleep,
} from '../../../scripts/verify/driver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { only: ONLY, shots: SHOTS, speed: SPEED, port: PORT, timings: TIMINGS } = parseFlags();
const shotDir = join(here, 'remount-shots');
const timer = createTimer(TIMINGS);
const { check, verdict } = createChecker();
const only = ONLY ? ONLY.split(',').filter(Boolean) : null;

/**
 * Load the generated example table into node.
 *
 * It is a `.ts` file with no imports, so stripping its types and importing the
 * result as a data URI is the whole job — cheaper and less brittle than
 * bundling, and it stays honest because it is the very file the app imports.
 */
const genPath = resolve(here, '../../../packages/planner/src/examples.generated.ts');
const { code: genJs } = await transform(readFileSync(genPath, 'utf8'), {
  loader: 'ts',
  format: 'esm',
});
const { EXAMPLE_PROGRAMS } = await import(
  `data:text/javascript;base64,${Buffer.from(genJs).toString('base64')}`
);

/*
 * On pacing: `SPEED` above comes from the shared `parseFlags`, which is already
 * 20 by default and 1 under `--shots` — a frame captured mid-tween at speed 20
 * is a blur. `Player.ms()` floors every step at 24ms (see
 * `packages/render/src/player.ts:358`), so views, animations and state
 * transitions all still happen; only the waiting is gone.
 */

if (SHOTS) mkdirSync(shotDir, { recursive: true });

const keys = Object.keys(EXAMPLE_PROGRAMS)
  .filter((key) => !only || only.includes(key))
  .sort();

if (keys.length === 0) {
  console.error(
    `no example programs${only ? ` matching --only=${only}` : ''}.\n` +
      `  known: ${Object.keys(EXAMPLE_PROGRAMS).join(' | ')}\n` +
      'They come from examples/manifest.json; re-inline with `./run.sh examples`.',
  );
  process.exit(1);
}

const server = await serveOn(PORT, {
  cwd: resolve(here, '..'),
  command: 'npx',
  args: ['next', 'dev', '-p', String(PORT)],
  label: 'next dev',
});
const BASE = process.env.BASE_URL ?? server.url;
timer.mark('next dev boot');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
timer.mark('chromium launch');

/**
 * Play to the end by pressing Next, exactly as a student would.
 *
 * A lesson parks at every beat boundary, so "done" is somewhere a student walks
 * to — which also means every boundary gets exercised rather than played
 * straight through.
 *
 * The budget is per PROGRAM, not per step. At `?speed=20` the longest example
 * finishes in well under a second, so 15s is not a tight cap — it is the point
 * at which "still playing" means "wedged". `--shots` runs at real pacing and
 * gets the generous one.
 */
async function playToEnd(page, budgetMs = SHOTS ? 60_000 : 15_000) {
  const t0 = Date.now();
  let beats = 0;
  for (;;) {
    const state = await page.$eval('.lesson-stage', (el) => el.dataset.state).catch(() => null);
    if (state === 'done') return { state: 'done', beats };
    if (state === 'failed') {
      const msg = await page.$eval('.lesson-error', (el) => el.textContent).catch(() => '?');
      return { state: 'failed', beats, error: (msg ?? '').trim() };
    }
    if (state === 'paused') {
      const next = await page.$('.lesson-step-next:not([disabled])');
      if (!next) return { state: 'done', beats };
      beats += 1;
      await next.click();
    }
    if (Date.now() - t0 > budgetMs) return { state: 'timeout', beats, error: `state=${state}` };
    // 100ms here was longer than a whole beat at speed 20 — the poll, not the
    // playback, set the pace.
    await sleep(SHOTS ? 100 : 20);
  }
}

console.log(`• mounting ${keys.length} example program(s) at speed=${SPEED}\n`);

/**
 * Tear the server down even when this script throws.
 *
 * Learned the hard way: an uncaught error here skipped `server.stop()` and left
 * an orphaned next-server on :3210. It answered `/` — so the next run happily
 * "reused" it — but could no longer compile a new route, so every subsequent
 * run died in `page.goto` with a timeout that blamed the page. A crash must not
 * poison the next run.
 */
process.on('exit', () => {
  try {
    server.stop();
  } catch {
    /* best effort — we are already on the way out */
  }
});

const report = [];
for (const key of keys) {
  const { js, source, dir } = EXAMPLE_PROGRAMS[key];

  // `?speed=` is read by LessonCanvas off the URL, exactly as the app gate does.
  // Player.ms() still floors each step at 24ms, so this stays a real walk.
  await page.goto(`${BASE}/playground?speed=${SPEED}`, { waitUntil: 'domcontentloaded' });
  // `__mount` is installed by a useEffect, so it exists only after hydration —
  // `domcontentloaded` fires well before that.
  await page.waitForFunction(() => typeof window.__mount === 'function');
  await page.evaluate(([j, s]) => window.__mount(j, s), [js, source]);

  const { state, beats, error } = await playToEnd(page);
  const stats = await page
    .$eval('.lesson-stage', (el) => ({
      svg: el.querySelectorAll('svg').length,
      nodes: el.querySelectorAll('*').length,
      text: (el.textContent ?? '').trim().length,
    }))
    .catch(() => ({ svg: 0, nodes: 0, text: 0 }));
  const detail = `${state}${error ? `: ${error}` : ''} · ${beats} beat(s) · ${stats.nodes} nodes`;

  check(`${dir}: runs to done`, state === 'done', detail);
  check(`${dir}: drew something`, stats.svg > 0 || stats.nodes > 40, JSON.stringify(stats));

  if (SHOTS) await page.screenshot({ path: join(shotDir, `${dir}.png`), fullPage: true });
  report.push({ key, dir, state, beats, nodes: stats.nodes, error });
  timer.mark('mount + walk');
}

console.log('\n' + '─'.repeat(70));
for (const r of report) {
  console.log(
    `${r.state === 'done' ? '✓' : '✗'} ${r.dir.padEnd(18)} ${String(r.state).padEnd(8)} ` +
      `${String(r.beats ?? 0).padStart(2)} beats  ${String(r.nodes ?? 0).padStart(4)} nodes`,
  );
}

// A page error the stage swallowed is still a defect.
check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
await server.stop();
if (SHOTS) console.log(`\nshots in ${shotDir}`);
timer.report();
process.exit(verdict()); // verdict() prints the failing lines itself
