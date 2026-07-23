import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';

async function hostWithScope() {
  const world = createWorld();
  const stage = createStage(world); // headless
  const scope = createProgramScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  return { world, stage, scope, host };
}

// The guest program is a plain double-quoted string so its backtick tagged
// templates and TeX backslashes embed cleanly. It exercises every cross-
// boundary shape: methods returning handles, guest closures re-invoked by the
// host (contains / by / apply / judge), a tagged-template formula reading
// `strings.raw`, and reactive collection growth re-bucketing live.
const PROGRAM = [
  'const Sigma = M.alphabet(["0", "1"]);',
  'const L = M.language({ alphabet: Sigma, label: "even ones", contains: w => w.count("1") % 2 === 0 });',
  'const membership = w => L.contains(w) ? { label: "ACCEPT", polarity: "accept" } : { label: "REJECT", polarity: "reject" };',
  'const x = M.word("0"), y = M.word("100"), z = M.word("1");',
  'lesson.say`${x} vs ${y}`;',
  'const exp = lesson.compareExperiment({ subjects: [x, y], apply: h => h.append(z), judge: membership, layout: "side-by-side" });',
  'const words = M.words(["", "1", "11", "01", "10"]);',
  'const byParity = M.partition(words, { by: w => w.count("1") % 2, labels: { 0: "EVEN", 1: "ODD" } });',
  'lesson.show(View.partition(byParity, { as: "buckets" }));',
  'const nerode = F.tex`x \\sim_L y \\iff ${F.span("suffix", "z")} \\in \\Sigma`;',
  'lesson.show(View.formula(nerode));',
  'words.add(M.word("111"));', // reactive growth re-invokes the guest `by` closure live
  'globalThis.__probe = {',
  '  classes: byParity.classes.length,',
  '  agreement: exp.agreement,',
  '  evenLabel: byParity.class("EVEN").label,',
  '  oddMembers: byParity.class("ODD").members.length,',
  '  roles: nerode.roles.length,',
  '  hasBackslashInTex: nerode.tex.indexOf("\\\\sim") >= 0,',
  '  appended: x.append(z).text,',
  '};',
].join('\n');

describe('bridge marshalling', () => {
  it('runs a program unmodified through the sandbox and builds the host lesson', async () => {
    const { world, host } = await hostWithScope();
    host.run(PROGRAM);

    // Host-side truth: the lesson timeline was actually built by guest calls.
    expect(world.timeline.root.length).toBeGreaterThan(0);

    // Guest-side truth (read back): closures re-invoked correctly, formula
    // preserved raw TeX, partition re-bucketed the live arrival.
    const probe = host.evalJSON<Record<string, unknown>>('__probe');
    expect(probe).toMatchObject({
      classes: 2,
      agreement: 'distinguished', // "0"+"1"="01" (odd) vs "100"+"1"="1001" (even)
      evenLabel: 'EVEN',
      roles: 1,
      hasBackslashInTex: true,
      appended: '01',
    });
    // ODD = {"1","01","10"} + live arrival "111" -> 4
    expect(probe.oddMembers).toBe(4);
    host.dispose();
  });
});
