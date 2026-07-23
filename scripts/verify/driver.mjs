/**
 * scripts/verify/driver.mjs — the shared spine of every browser gate.
 *
 * The verify scripts all needed the same four things and each had grown its own
 * copy: find Chromium, get a server up, poll for a condition, tally checks.
 * They also each had their own idea of how long to wait, which is why a failing
 * run used to cost three minutes before it admitted anything was wrong.
 *
 * The rule here is that WAITING IS A BUG. A gate should spend its time
 * executing, not sleeping — so the defaults are: fast playback (`?speed=`),
 * tight polling, short timeouts, and no screenshots. Full fidelity is what
 * `--shots --speed=1` is for, and that is the milestone record, not the loop.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { get as httpGet } from 'node:http';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);

// ──────────────────────────────── flags ────────────────────────────────

/**
 * Every gate takes the same flags. The out dir is the first POSITIONAL
 * argument — flags may precede it, which is what once turned `--only=markov`
 * into a directory of that name.
 */
export function parseFlags(argv = process.argv.slice(2)) {
  const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const shots = argv.includes('--shots');
  return {
    out: argv.find((a) => !a.startsWith('--')) ?? null,
    only: flag('only') ?? null,
    // Which example a gate should walk, by its examples/ directory name. It is
    // separate from --only (which filters the BILLED live topics) because the
    // two namespaces are unrelated and silently matching nothing in one while
    // the other ran anyway has cost real money here before.
    example: flag('example') ?? null,
    live: argv.includes('--live'),
    timings: argv.includes('--timings'),
    shots,
    // Screenshots are the one thing that genuinely needs real-time pacing: a
    // mid-animation frame at speed 20 is a blur. So --shots implies speed 1
    // unless the caller overrode it outright.
    speed: Number(flag('speed') ?? (shots ? 1 : 20)),
    port: Number(flag('port') ?? 3210),
  };
}

// ─────────────────────────────── chromium ───────────────────────────────

/**
 * The Playwright cache pins an exact build number, so hardcoding one means the
 * gate breaks silently on the next `playwright install`. Take the newest.
 */
export function chromiumPath() {
  const cache = join(homedir(), '.cache/ms-playwright');
  const builds = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  if (builds.length === 0) {
    throw new Error(`no chromium under ${cache} — run: npx playwright install chromium`);
  }
  return join(cache, builds[0], 'chrome-linux64/chrome');
}

export async function launchBrowser() {
  const { chromium } = require('playwright-core');
  return chromium.launch({ executablePath: chromiumPath(), headless: true });
}

// ──────────────────────────────── server ────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is anything at all holding the port? Cheap, and says nothing about health. */
function portBound(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
      .on('connect', () => (socket.end(), resolve(true)))
      .on('error', () => resolve(false));
  });
}

/**
 * Does the port SERVE? A TCP connect is not an answer to that question.
 *
 * The kernel completes the handshake into the listen backlog whether or not
 * the process ever calls accept(), so a wedged next-server looks exactly like
 * a healthy one to a connect probe. That is not hypothetical: a server killed
 * mid-compile once sat here at 118% CPU with twenty connections queued, and
 * every gate that "reused" it died thirty seconds later inside page.goto with
 * a timeout that named the page instead of the server.
 *
 * So: ask for a byte back, with a deadline.
 */
function portServes(port, timeout = 3_000) {
  return new Promise((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/', timeout }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => (req.destroy(), resolve(false)));
    req.on('error', () => resolve(false));
  });
}

/**
 * Bring a server up on `port` and hand back a `stop()`.
 *
 * If something already answers there, that server is REUSED and `stop()` is a
 * no-op — a gate must never kill a dev server it did not start, and a warm
 * server is the difference between a 10s Next cold compile and none.
 */
export async function serveOn(port, { cwd, command, args, label = 'server' }) {
  if (await portBound(port)) {
    if (await portServes(port)) {
      console.log(`• reusing the ${label} already on :${port}`);
      return { url: `http://localhost:${port}`, stop: async () => {} };
    }
    // Bound but not serving. Say so HERE, in one line, rather than letting it
    // surface as a 30s page.goto timeout that blames the page.
    throw new Error(
      `:${port} is held by a process that accepts connections but does not answer HTTP ` +
        `(a wedged or half-killed dev server). Free it and re-run:\n` +
        `    ss -ltnp 'sport = :${port}'   # find the pid\n` +
        `    kill <pid>`,
    );
  }

  console.log(`• starting ${label} on :${port}`);
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  let died = null;
  child.on('exit', (code) => (died = code));

  const t0 = Date.now();
  // Wait for it to SERVE, not merely to bind: Next binds the port well before
  // the first route is compiled, and a gate that starts navigating in that gap
  // is racing the compiler.
  while (!(await portServes(port))) {
    if (died !== null) throw new Error(`${label} exited (${died}):\n${log.join('')}`);
    if (Date.now() - t0 > 120_000) throw new Error(`${label} never served :${port}:\n${log.join('')}`);
    await sleep(100);
  }
  console.log(`• ${label} up in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const stop = async () => {
    // Next spawns workers, and SIGTERM alone does not reliably take them with
    // it: one killed mid-compile survived, was reparented to init, and sat
    // spinning on the port — poisoning every later run, which then "reused" it.
    // So escalate, and do not return until the port is actually free.
    const signal = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        /* already gone */
      }
    };
    signal('SIGTERM');
    const deadline = Date.now() + 5_000;
    while (await portBound(port)) {
      if (Date.now() > deadline) {
        signal('SIGKILL');
        break;
      }
      await sleep(100);
    }
  };
  return { url: `http://localhost:${port}`, stop };
}

// ──────────────────────────────── waiting ────────────────────────────────

/**
 * Poll `fn` until it returns something truthy, or give up.
 *
 * 50ms, not the 250ms these scripts used to poll at: a beat walk makes ~50 of
 * these calls, and at 250ms the polling alone was most of the wall clock. The
 * timeout is short on purpose — when a beat hangs you want to hear about it in
 * twenty seconds, not three minutes.
 */
export async function waitFor(fn, { timeout = 20_000, poll = 50 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - t0 > timeout) return null;
    await sleep(poll);
  }
}

export { sleep };

// ─────────────────────────────── timings ───────────────────────────────

/**
 * A stopwatch with named laps, printed only under `--timings`.
 *
 * "Waiting is a bug" is a rule you can only enforce if you can see the waiting.
 * Guessing at it does not work: the fixed cost of this gate was confidently
 * attributed to Next's cold compile until someone measured and found the dev
 * server had been warm the whole time.
 *
 * Zero cost when the flag is off — `mark()` is two Date.now() calls.
 */
export function createTimer(enabled = false) {
  const t0 = Date.now();
  const marks = [];
  let last = t0;
  return {
    mark(label) {
      const now = Date.now();
      if (enabled) marks.push([label, now - last]);
      last = now;
    },
    report() {
      if (!enabled || marks.length === 0) return;
      const total = Date.now() - t0;
      // Roll up repeated per-example labels so four examples do not print
      // forty lines: the question is always "which phase", not "which beat".
      const rolled = new Map();
      for (const [label, ms] of marks) rolled.set(label, (rolled.get(label) ?? 0) + ms);
      const rows = [...rolled].sort((a, b) => b[1] - a[1]);
      console.log('\n──────── where the time went ────────');
      for (const [label, ms] of rows) {
        const pct = ((ms / total) * 100).toFixed(0);
        console.log(`${String(ms).padStart(6)}ms ${String(pct).padStart(4)}%  ${label}`);
      }
      console.log(`${String(total).padStart(6)}ms  100%  TOTAL`);
    },
  };
}

// ──────────────────────────────── checks ────────────────────────────────

/** A tally of PASS/FAIL lines and the exit code they add up to. */
export function createChecker() {
  const failures = [];
  const t0 = Date.now();
  return {
    check(label, ok, detail) {
      const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
      console.log(line);
      if (!ok) failures.push(line);
      return ok;
    },
    get failures() {
      return failures;
    },
    /** Print the verdict and return the exit code. Never exits for the caller. */
    verdict() {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (failures.length > 0) {
        console.error(`\n${failures.length} FAILURE(S) in ${secs}s`);
        for (const line of failures) console.error(`  ${line}`);
        return 1;
      }
      console.log(`\nALL CHECKS PASSED in ${secs}s`);
      return 0;
    },
  };
}

/**
 * Browser-side noise that should fail a gate: console errors and 4xx/5xx.
 * Wired once per page so no gate forgets to look.
 */
export function watchForNoise(page) {
  const consoleErrors = [];
  const badResponses = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
      consoleErrors.push(m.text());
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) {
      badResponses.push(`${r.status()} ${r.url()}`);
    }
  });
  return {
    report(check) {
      const noisy = consoleErrors.filter((e) => !/Download the React DevTools/i.test(e));
      check('no console errors', noisy.length === 0, noisy.slice(0, 3).join(' | '));
      check('no failed requests', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));
    },
  };
}
