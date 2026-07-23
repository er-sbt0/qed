/**
 * Generation eval for the lesson-program pipeline (OPT-IN — makes billed API calls).
 *
 * This replaces the golden-SCENE eval. There is no scene to inspect any more:
 * the answer is a program, so what can be checked cheaply from a shell is the
 * PLAN and the GATE — did the model plan sensible beats, did the program it
 * wrote survive extract/shape/syntax/lint, and did it need a repair to get
 * there. Whether the program then *renders* is a browser question, and lives in
 * `apps/web/verify/screenshot.mjs --live`.
 *
 * The questions are the ones the old declarative examples covered (the Mean
 * Value Theorem, Cauchy–Schwarz, vector geometry, 3D surfaces) plus topics with
 * NO discipline library behind them — because the two-tier vocabulary's whole
 * claim is that an unanticipated discipline is still sayable from the kernel.
 * A question that plans `disciplines: []` and still produces a program is the
 * evidence for that claim.
 *
 * Prereq: the web app running with ANTHROPIC_API_KEY set, e.g.
 *   cd apps/web && npx next dev -p 3210
 * Then, in another shell:
 *   node scripts/eval-harness.mjs                       # hits localhost:3000
 *   BASE=http://localhost:3210 node scripts/eval-harness.mjs
 *   OUT=/tmp/programs node scripts/eval-harness.mjs     # keep the programs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = process.env.OUT ?? null;
if (OUT) mkdirSync(OUT, { recursive: true });

/**
 * `library` marks the questions a discipline pack should cover; `kernel` marks
 * the ones nothing models, where an empty `disciplines` is the RIGHT answer.
 */
const CASES = [
  { slug: 'mvt', q: 'Show me the Mean Value Theorem', topic: /mean value|mvt/i, tier: 'library' },
  { slug: 'cauchy-schwarz', q: 'Explain the Cauchy–Schwarz inequality', topic: /cauchy|schwarz/i, tier: 'library' },
  { slug: 'derivative', q: 'What does the derivative mean as a limit?', topic: /deriv|secant|tangent|limit/i, tier: 'library' },
  { slug: 'dot-product', q: 'When are two vectors perpendicular?', topic: /perpendic|orthogon|dot/i, tier: 'library' },
  { slug: 'vector-addition', q: 'How does vector addition work?', topic: /vector|addition|triangle/i, tier: 'library' },
  { slug: 'saddle', q: 'Graph the 3D surface z = x^2 - y^2', topic: /saddle|surface|paraboloid/i, tier: 'library' },
  { slug: 'pigeonhole', q: 'Explain the pigeonhole principle', topic: /pigeonhole/i, tier: 'kernel' },
  { slug: 'group', q: 'What makes a set with an operation a group?', topic: /group|axiom/i, tier: 'kernel' },
];

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const summary = [];

for (const c of CASES) {
  console.log(`\nQ: ${c.q}`);
  let data;
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: c.q }),
    });
    data = await res.json();
    if (!res.ok) {
      ok('request', false, `HTTP ${res.status}: ${data?.error ?? 'no error text'}`);
      continue;
    }
  } catch (e) {
    ok('request', false, String(e));
    continue;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const { plan, program, failure, attempts, explanation } = data;
  ok('plan came back', !!plan?.topic, plan?.topic);
  ok('topic is on target', c.topic.test(`${plan?.topic} ${explanation}`), plan?.topic);
  ok(
    'beats are an outline, not a scene list',
    Array.isArray(plan?.beats) && plan.beats.length >= 2 && plan.beats.length <= 8,
    `${plan?.beats?.length} beats`,
  );

  // The two-tier claim: no library for this topic must NOT mean no answer.
  if (c.tier === 'kernel') {
    ok('kernel-only topic still produced a program', !!program, `disciplines=[${plan?.disciplines}]`);
  }

  ok(
    'program passed the gate',
    !!program,
    program
      ? `${program.source.split('\n').length} lines · ${attempts} attempt(s) · ${secs}s`
      : `${failure?.stage}: ${failure?.errors?.join('; ')}`,
  );

  if (program) {
    const warnings = (program.findings ?? []).filter((f) => f.severity === 'warning');
    ok('no lint warnings', warnings.length === 0, warnings.map((w) => w.rule).join(', '));
    ok('authors a timeline', /\blesson\s*\./.test(program.source));
    if (OUT) writeFileSync(join(OUT, `${c.slug}.ts`), program.source);
  }

  summary.push({
    slug: c.slug,
    tier: c.tier,
    topic: plan?.topic,
    disciplines: plan?.disciplines,
    beats: plan?.beats?.length,
    attempts,
    secs: Number(secs),
    lines: program?.source.split('\n').length ?? 0,
    gated: !!program,
  });
}

console.log('\n' + '─'.repeat(72));
for (const s of summary) {
  console.log(
    `${s.gated ? '✓' : '✗'} ${s.slug.padEnd(16)} ${String(s.tier).padEnd(8)} ` +
      `${String(s.lines).padStart(4)} lines  ${s.attempts}× ${String(s.secs).padStart(5)}s  ` +
      `[${(s.disciplines ?? []).join(',')}]`,
  );
}
if (OUT) console.log(`\nprograms written to ${OUT}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
