/**
 * verify/screenshot.mjs — the demo gate.
 *
 * What this actually proves is that every demo runs to `done` in a real browser
 * with no page error. It used to prove that only incidentally, on the way to
 * capturing images: three hardcoded sleeps (2.2s, 1.2s, 2.5s) existed purely to
 * catch a mid-animation frame, and the run played at speed 6 so the frames
 * would look right.
 *
 * So the images are now opt-in and the assertions are the point. `--shots`
 * brings back the captures — and drops the pace back down, because a
 * mid-animation frame at speed 20 is a blur.
 *
 *   node verify/screenshot.mjs            # fast: assert every demo completes
 *   node verify/screenshot.mjs --shots    # + the images, at a photogenic pace
 */
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createChecker,
  launchBrowser,
  parseFlags,
  sleep,
  waitFor,
} from '../../../scripts/verify/driver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + join(here, '..', 'demo', 'dist', 'index.html');
const { shots: SHOTS, speed: SPEED, out: outArg } = parseFlags();
// --shots defaults the pace to 1; these demos were composed to be watched at 6.
const pace = SHOTS && SPEED === 1 ? 6 : SPEED;
const out = resolve(outArg ?? join(here, 'shots'));
if (SHOTS) mkdirSync(out, { recursive: true });

const { check, verdict } = createChecker();
const DEMOS = [1, 2, 3];

async function status(page) {
  return page.evaluate(() => window.__status);
}

/** Run until `done:${n}`, or say why not. Returns null on success. */
async function waitDone(page, n) {
  const hit = await waitFor(async () => {
    const s = await status(page);
    return s === `done:${n}` || s?.startsWith('error:') ? s : null;
  });
  if (hit === null) return `timeout (at ${await status(page)})`;
  return hit.startsWith('error:') ? hit : null;
}

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });

  console.log(`• demo gate at speed=${pace}${SHOTS ? ' with shots' : ''}`);
  await page.goto(`${url}?speed=${pace}`);

  for (const n of DEMOS) {
    await page.evaluate((d) => void window.__run(d), n);
    if (SHOTS) {
      // The mid-run frame is the only thing a wall-clock sleep can get: there
      // is no "halfway" event to wait on. It costs seconds, so it is opt-in.
      await sleep(n === 2 ? 1200 : n === 3 ? 2500 : 2200);
      await page.locator(`#demo${n}`).screenshot({ path: join(out, `demo${n}-mid.png`) });
    }
    const failed = await waitDone(page, n);
    check(`demo ${n} ran to done`, failed === null, failed ?? undefined);
    if (SHOTS) await page.locator(`#demo${n}`).screenshot({ path: join(out, `demo${n}-done.png`) });
  }
  if (SHOTS) await page.screenshot({ path: join(out, 'all-light.png'), fullPage: true });

  // dark theme pass — the package styles both, and `auto` runs the lot
  await page.goto(`${url}?speed=20&theme=dark&auto`);
  const dark = await waitFor(async () => {
    const s = await status(page);
    return s === 'done:all' || s?.startsWith('error:') ? s : null;
  });
  check('dark theme ran to done', dark === 'done:all', dark ?? 'timeout');
  if (SHOTS) await page.screenshot({ path: join(out, 'all-dark.png'), fullPage: true });

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  if (SHOTS) console.log(`\nshots in ${out}`);
} finally {
  await browser.close();
}
process.exit(verdict());
