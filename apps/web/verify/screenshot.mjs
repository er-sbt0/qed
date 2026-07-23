/**
 * verify/screenshot.mjs — the app gate.
 *
 * Two things need proving in a real browser, and only one of them costs money:
 *
 *  1. THE PROGRAM PATH WORKS IN THE APP (no API key). The acceptance program
 *     renders through the app's own `<LessonCanvas>` — Next bundling, the wasm
 *     variant, the theme CSS, the player, KaTeX. If a program that passed the
 *     milestone-6 gate renders here, the app is a faithful host.
 *  2. GENERATION WORKS (needs ANTHROPIC_API_KEY, billed). Ask real questions,
 *     execute what comes back, and check it.
 *
 * The gate runs at `?speed=20` by default and writes NO images. Playback is
 * still real — `Player.ms()` floors a step at 24ms, so every view mounts and
 * every transition fires; the harness just stops waiting out the pacing. Ask
 * for `--shots` when you want the pictures, and it drops back to real time.
 *
 *   node verify/screenshot.mjs                 # the gate: the newest example
 *   node verify/screenshot.mjs --example=ftc   # ...that one instead
 *   node verify/screenshot.mjs --shots out/    # full fidelity, with images
 *   node verify/screenshot.mjs --timings       # print where the time went
 *   node verify/screenshot.mjs --live          # + real generation (billed)
 *
 * A dev server is started on :3210 and torn down on the way out. One already
 * listening there is reused and left running.
 */
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createChecker,
  createTimer,
  launchBrowser,
  parseFlags,
  serveOn,
  sleep,
  waitFor,
  watchForNoise,
} from '../../../scripts/verify/driver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const {
  example: EXAMPLE_FLAG,
  only: ONLY_FLAG,
  live: LIVE,
  shots: SHOTS,
  speed: SPEED,
  port: PORT,
  timings: TIMINGS,
} = parseFlags();
const timer = createTimer(TIMINGS);
const repo = resolve(here, '..', '..', '..');

/**
 * THE GATE WALKS ONE EXAMPLE, AND IT DOES NOT CARE WHICH.
 *
 * What this proves is browser-shaped — Next bundling, the wasm variant, theme
 * CSS, KaTeX, the player, seek. Those are properties of the HOST, not of the
 * lesson, so ONE lesson exercises them; walking four re-proved the same facts
 * four times for ~34s. What extra lessons add is per-lesson rendering, and that
 * belongs in the unit tier, which does not need a browser. To mount them all
 * anyway — the right check after editing examples/ — use `./run.sh remount`.
 *
 * It used to name its representative in this file, which quietly made one
 * lesson load-bearing: the gate could not run without it, so the program the
 * corpus was most free to replace was the one thing nobody could delete.
 * Nothing here names a lesson now. `examples/` is recorded model output
 * (`./run.sh record`), so the default is simply the NEWEST recording — the
 * program most likely to exercise vocabulary that just changed — and any other
 * is one flag away:
 *
 *   ./run.sh verify --example=<dir>      # a directory name under examples/
 *
 * Every assertion below is written against whatever that resolves to: beats
 * exist, each one draws, seek matches stepping. No beat titles, no op counts.
 */
function galleryExamples() {
  const { examples } = JSON.parse(readFileSync(join(repo, 'examples', 'manifest.json'), 'utf8'));
  return examples
    .map((e) => {
      // meta.json is written by the recorder; a hand-written example has none,
      // and sorts last rather than being excluded — it is still walkable.
      let recordedAt = '';
      try {
        const metaPath = join(repo, 'examples', e.dir, 'meta.json');
        recordedAt = JSON.parse(readFileSync(metaPath, 'utf8')).recordedAt ?? '';
      } catch {
        recordedAt = '';
      }
      return { ...e, recordedAt };
    })
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

const EXAMPLES = galleryExamples();
if (EXAMPLES.length === 0) {
  console.error('examples/manifest.json lists nothing — record one: ./run.sh record "<question>"');
  process.exit(1);
}

/**
 * The two namespaces this script scopes over — examples and live topics. They
 * are unrelated, and they get SEPARATE flags for a reason that cost money:
 *
 * `--only=derivative` once billed four unbilled-for generations. It named a
 * slug from a sibling script's list, so it matched no example — the walk
 * silently did nothing — while the live section ignored `--only` entirely and
 * generated all four QUESTIONS anyway. A flag that scopes nothing is
 * survivable on the free path; on the BILLED path it spends money the caller
 * explicitly tried not to spend. Hence: `--example=` picks the example,
 * `--only=` filters the billed topics, and an unrecognized value of either is
 * a hard exit before the browser launches.
 */
const QUESTIONS = [
  ['calculus', 'Explain the Fundamental Theorem of Calculus'],
  ['linalg', 'What does the determinant of a 2x2 matrix mean geometrically?'],
  ['probability', 'Why does a Markov chain converge to a stationary distribution?'],
  ['kernel', 'Explain the pigeonhole principle'],
];

const TARGET = EXAMPLE_FLAG ? EXAMPLES.find((e) => e.dir === EXAMPLE_FLAG) : EXAMPLES[0];
if (!TARGET) {
  console.error(
    `--example=${EXAMPLE_FLAG} matches nothing under examples/.\n` +
      `  examples: ${EXAMPLES.map((e) => e.dir).join(' | ')}\n` +
      'To mount every example instead of walking one, use `./run.sh remount`.',
  );
  process.exit(1);
}

if (ONLY_FLAG) {
  const topics = QUESTIONS.map(([s]) => s);
  if (!topics.includes(ONLY_FLAG)) {
    console.error(
      `--only=${ONLY_FLAG} matches no live topic.\n` +
        `  live topics: ${topics.join(' | ')}\n` +
        '`--only=` filters the BILLED generations; to choose the example that is ' +
        'walked, use `--example=<dir>`.',
    );
    process.exit(1);
  }
  if (!LIVE) {
    console.error('--only= filters live topics but --live was not passed, so it scopes nothing.');
    process.exit(1);
  }
}

const out = resolve(parseFlags().out ?? join(here, 'shots'));
if (SHOTS) mkdirSync(out, { recursive: true });

const { check, verdict } = createChecker();
/** No-op unless --shots: the images are the milestone record, not the loop. */
const shoot = async (page, name, opts) =>
  SHOTS ? page.screenshot({ path: join(out, name), ...opts }) : undefined;

// ─────────────────────────────── the app ───────────────────────────────

const server = await serveOn(PORT, {
  cwd: resolve(here, '..'),
  command: 'npx',
  args: ['next', 'dev', '-p', String(PORT)],
  label: 'next dev',
});
const BASE = process.env.BASE_URL ?? server.url;
timer.mark('next dev boot');

const browser = await launchBrowser();
timer.mark('chromium launch');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const noise = watchForNoise(page);

/**
 * Wait for a lesson canvas to come to rest.
 *
 * Playback is STEPPED: a lesson parks at every beat boundary and waits for the
 * student, so the resting states are `paused` (more beats to come) and `done`
 * (the last one played). Anything else is still in flight.
 */
async function waitForCanvas(page) {
  // A control's state change lands in React before the next paint, but a click
  // resolves before that: settle first, or a jump reads as "already there".
  await sleep(30);
  const state = await waitFor(async () => {
    const s = await page.$eval('.lesson-stage', (el) => el.dataset.state).catch(() => null);
    return s === 'done' || s === 'paused' || s === 'failed' ? s : null;
  });
  if (state === null) return 'timeout';
  if (state === 'failed') {
    const msg = await page.$eval('.lesson-error', (el) => el.textContent).catch(() => '?');
    return `failed: ${msg}`;
  }
  return state;
}

/** Play every remaining beat, so a lesson ends where it used to end. */
async function playToEnd(page) {
  for (let guard = 0; guard < 40; guard += 1) {
    const state = await waitForCanvas(page);
    if (state !== 'paused') return state;
    const next = await page.$('.lesson-step-next:not([disabled])');
    if (!next) return await waitForCanvas(page);
    await next.click();
  }
  return 'runaway';
}

/**
 * What the stage IS, independent of when you look at it.
 *
 * Ambient loops keep animating while parked, so coordinates and transforms
 * drift between two visits to the same beat. The invariant that must match is
 * the CONTENT: the text on the stage and the shape of its DOM.
 */
async function beatFingerprint(page) {
  return page.$eval('.lesson-stage', (el) => {
    const tags = {};
    for (const node of el.querySelectorAll('*')) {
      tags[node.tagName] = (tags[node.tagName] ?? 0) + 1;
    }
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({ text, tags });
  });
}

async function beatState(page) {
  return page.$eval('.lesson-stage', (el) => ({
    step: Number(el.dataset.step),
    steps: Number(el.dataset.steps),
  }));
}

/** How much did the program actually draw? A blank stage is a silent failure. */
async function stageStats(page) {
  return page.$eval('.lesson-stage', (el) => ({
    svg: el.querySelectorAll('svg').length,
    nodes: el.querySelectorAll('*').length,
    katex: el.querySelectorAll('.katex').length,
    text: (el.textContent ?? '').trim().length,
  }));
}

// ─────────────────── 1. the example programs, in the app ───────────────────

console.log(
  `• gate at speed=${SPEED}${SHOTS ? ' with shots' : ''}` +
    ` — ${TARGET.dir} only` +
    (EXAMPLE_FLAG
      ? ''
      : ` (the newest recording; --example=<dir> picks another, ` +
        '`./run.sh remount` mounts them all)'),
);
// `domcontentloaded`, not `networkidle`: the latter blocks on a 500ms quiet
// window that proves nothing here. Every real readiness signal is already
// waited for downstream — Playwright's click auto-waits for the tab, and
// waitForCanvas() polls for the stage to come to rest.
await page.goto(`${BASE}/?speed=${SPEED}`, { waitUntil: 'domcontentloaded' });
check('app loads', (await page.title()).length > 0);
timer.mark('first route load');

// The gallery labels its tabs by DISCIPLINE (page.tsx derives them from the
// example table's keys), not by the model-written title — so that is what the
// click has to match.
const tabLabel = (e) => e.key.replace(/-/g, ' ');

/**
 * Select a tab, and do not proceed until the app AGREES it is selected.
 *
 * A plain `page.click()` is not enough and the failure is silent. The tabs are
 * server-rendered, so they exist and are clickable before React hydrates; a
 * click that lands in that window does nothing at all. That was invisible while
 * the gallery had ONE tab which was also the default — a lost click changed
 * nothing that could be observed. With one tab per discipline it means the gate
 * walks whatever was selected by default, cheerfully labelling every check with
 * the name of the lesson it did not open. A gate that reports PASS against the
 * wrong subject is worse than one that fails.
 *
 * So: click until `aria-selected` flips, then assert it. The retry IS the
 * hydration wait — there is no earlier signal worth polling for.
 */
async function selectTab(page, label) {
  const sel = `[role="tab"]:has-text("${label}")`;
  await page.waitForSelector(sel);
  return waitFor(async () => {
    await page.click(sel);
    return page.$eval(sel, (el) => el.getAttribute('aria-selected') === 'true');
  });
}

for (const { dir: slug } of [TARGET]) {
  const selected = await selectTab(page, tabLabel(TARGET));
  // Load-bearing: everything below is labelled with TARGET, so if the wrong
  // lesson is on screen every subsequent PASS is a lie.
  check(`${slug}: the gallery opened it (tab "${tabLabel(TARGET)}" is selected)`, selected);

  // ── the first beat plays and PARKS: that is the default ──
  const first = await waitForCanvas(page);
  check(`${slug}: first beat played`, first === 'paused' || first === 'done', first);
  const { steps } = await beatState(page);
  check(`${slug}: has beats`, steps > 1, `${steps} segment(s)`);
  timer.mark('tab switch + first beat');

  // ── walk it beat by beat, recording what each boundary looks like ──
  const forward = [];
  for (let i = 0; ; i += 1) {
    const state = await waitForCanvas(page);
    if (typeof state === 'string' && (state.startsWith('failed') || state === 'timeout')) {
      check(`${slug}: beat ${i} played`, false, state);
      break;
    }
    const at = await beatState(page);
    check(`${slug}: parked at beat ${i}`, at.step === i, `data-step=${at.step}`);
    // Per beat the bar is lower than for a finished lesson: an opening beat is
    // often just the question in prose, with nothing drawn yet.
    const stats = await stageStats(page);
    check(
      `${slug}: beat ${i} put something on the stage`,
      stats.nodes > 10 && stats.text > 20,
      JSON.stringify(stats),
    );
    forward.push(await beatFingerprint(page));
    await shoot(page, `beat-${slug}-${i}.png`);
    const next = await page.$('.lesson-step-next:not([disabled])');
    if (!next) break;
    await next.click();
  }
  timer.mark('forward beat walk');
  check(`${slug}: stepped through every beat`, forward.length === steps, `${forward.length}/${steps}`);
  check(`${slug}: ends done`, (await waitForCanvas(page)) === 'done');
  check(
    `${slug}: Next is dead at the end`,
    (await page.$('.lesson-step-next:not([disabled])')) === null,
  );
  const whole = await stageStats(page);
  check(`${slug}: the finished lesson drew something`, whole.svg > 0 || whole.nodes > 30, JSON.stringify(whole));
  await shoot(page, `example-${slug}.png`, { fullPage: false });

  // ── BACKWARD = REBUILD: landing on beat k must equal having walked to k ──
  const target = Math.max(0, steps - 3);
  await page.click(`.lesson-rail li:nth-child(${target + 1}) .lesson-tick`);
  const back = await waitForCanvas(page);
  const at = await beatState(page);
  check(`${slug}: jumped back to beat ${target}`, at.step === target, `state=${back} step=${at.step}`);
  check(
    `${slug}: beat ${target} after a backward jump == stepping there`,
    (await beatFingerprint(page)) === forward[target],
  );
  await shoot(page, `back-${slug}-${target}.png`);
  timer.mark('backward jump (rebuild)');

  // ── FORWARD jump on the LIVE player (no rebuild) — same invariant ──
  const ahead = steps - 1;
  await page.click(`.lesson-rail li:nth-child(${ahead + 1}) .lesson-tick`);
  await waitForCanvas(page);
  const at2 = await beatState(page);
  check(`${slug}: seeked forward to beat ${ahead}`, at2.step === ahead, `step=${at2.step}`);
  check(
    `${slug}: beat ${ahead} after a forward seek == stepping there`,
    (await beatFingerprint(page)) === forward[ahead],
  );
  timer.mark('forward seek (live)');

  // ── the arrow keys page through it ──
  await page.click(`.lesson-rail li:nth-child(1) .lesson-tick`); // back to 0 (rebuild)
  await waitForCanvas(page);
  await page.keyboard.press('ArrowRight');
  await waitForCanvas(page);
  check(`${slug}: ArrowRight advances`, (await beatState(page)).step === 1);
  await page.keyboard.press('ArrowLeft');
  await waitForCanvas(page);
  check(`${slug}: ArrowLeft goes back`, (await beatState(page)).step === 0);
  timer.mark('arrow keys (incl. rebuild to 0)');

  // ── Replay returns to beat 0 ──
  await page.click('.lesson-replay');
  await waitForCanvas(page);
  check(`${slug}: Replay restarts at beat 0`, (await beatState(page)).step === 0);
  check(`${slug}: Back is dead at beat 0`, await page.$eval('.lesson-step-btn', (el) => el.disabled));
  timer.mark('replay to beat 0');
}

// dark theme — switch through the real two-state control. Same example as the
// walk: what is being checked is that the theme applies at all, not this
// lesson's colours.
await page.click('.theme-toggle');
await selectTab(page, tabLabel(TARGET));
await playToEnd(page);
await shoot(page, `example-${TARGET.dir}-dark.png`);
await page.click('.theme-toggle');

// ─────────────────── 2. live generation (billed, opt-in) ───────────────────

if (LIVE) {
  // A billed run is evidence by definition: every generated program is kept,
  // whatever the flags say about images.
  mkdirSync(out, { recursive: true });
  const report = [];
  // Honour --only here too: every iteration of this loop is billed.
  const asked = QUESTIONS.filter(([slug]) => !ONLY_FLAG || slug === ONLY_FLAG);
  console.log(`• live: generating ${asked.length} of ${QUESTIONS.length} topic(s) — BILLED`);
  for (const [slug, question] of asked) {
    console.log(`\n--- live: ${question}`);

    // Drive the real UI and intercept the response, so exactly ONE generation
    // is billed per question and the thing being verified is the app, not a
    // parallel code path. The long timeout is the model's, not the gate's.
    const captured = page.waitForResponse(
      (r) => r.url().endsWith('/api/chat') && r.request().method() === 'POST',
      { timeout: 300_000 },
    );
    const t0 = Date.now();
    await page.fill('input[aria-label="Math question"]', question);
    await page.click('button:has-text("Ask")');

    const res = await captured;
    const ms = Date.now() - t0;
    const body = await res.json();
    if (res.status() !== 200) {
      check(`${slug}: generated`, false, `HTTP ${res.status()}: ${body?.error}`);
      continue;
    }

    const { plan, program, failure, attempts } = body;
    check(
      `${slug}: plan`,
      !!plan?.topic,
      `topic="${plan?.topic}" beats=${plan?.beats?.length} disciplines=[${plan?.disciplines}]`,
    );
    check(
      `${slug}: program passed the gate`,
      !!program,
      program
        ? `${program.source.split('\n').length} lines, ${attempts} attempt(s), ${(ms / 1000).toFixed(1)}s`
        : `${failure?.stage}: ${failure?.errors?.join('; ')}`,
    );
    if (!program) continue;
    // Keep every generated program: these are the milestone's real evidence.
    writeFileSync(join(out, `live-${slug}.ts`), program.source);

    // A generated program is stepped like any other; the harness plays it out.
    const state = await playToEnd(page);
    const stats = await stageStats(page);
    check(`${slug}: ran in the browser`, state === 'done', state === 'done' ? undefined : state);
    check(`${slug}: drew something`, stats.svg > 0 || stats.nodes > 30, JSON.stringify(stats));
    await shoot(page, `live-${slug}.png`, { fullPage: true });
    report.push({
      slug,
      question,
      topic: plan.topic,
      disciplines: plan.disciplines,
      beats: plan.beats?.length,
      attempts,
      ms,
      lines: program.source.split('\n').length,
      warnings: program.findings?.filter((f) => f.severity === 'warning').length ?? 0,
      state,
      stats,
    });
    await page.click('.nav-home');
  }
  writeFileSync(join(out, 'live-report.json'), JSON.stringify(report, null, 2));
}

// ─────────────────────────────── verdict ───────────────────────────────

noise.report(check);

await browser.close();
await server.stop();
if (SHOTS) console.log(`\nshots in ${out}`);
timer.report();
process.exit(verdict());
