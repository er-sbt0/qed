import { describe, expect, it } from 'vitest';
import { lint } from './lint.js';

describe('static lint gate', () => {
  it('passes a clean lesson program', () => {
    const r = lint(`
      const Sigma = M.alphabet(["0", "1"]);
      const words = M.words(["", "1"]);
      const p = M.partition(words, { by: w => w.count("1") % 2 });
      lesson.show(View.partition(p, { as: "buckets" }));
    `);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it('rejects sandbox-escape globals', () => {
    for (const bad of ['eval("2")', 'fetch("/x")', 'process.exit(0)', 'require("fs")', 'new Function("x")']) {
      expect(lint(bad).ok, bad).toBe(false);
    }
  });

  it('rejects an obvious unbounded top-level loop but allows a bounded one', () => {
    expect(lint('while (true) { doStuff(); }').ok).toBe(false);
    expect(lint('for (;;) { work(); }').ok).toBe(false);
    // has an escape hatch -> not flagged
    expect(lint('while (true) { if (done) break; }').ok).toBe(true);
    expect(lint('for (let i = 0; i < 10; i++) { step(i); }').ok).toBe(true);
  });

  it('does not flag loops that appear inside strings/comments', () => {
    expect(lint('const s = "while (true) {}"; lesson.say`hi`;').ok).toBe(true);
    expect(lint('// while (true) {}\nlesson.show(v);').ok).toBe(true);
  });

  it('warns (does not fail) on nondeterminism sources', () => {
    const r = lint('const t = Date.now(); const r = Math.random();');
    expect(r.ok).toBe(true); // warnings do not fail the artifact
    expect(r.findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(r.findings.map((f) => f.rule)).toContain('nondeterminism');
  });

  it('rejects unbalanced structure', () => {
    expect(lint('lesson.show(View.tokens([a, b);').ok).toBe(false);
  });
});

describe('beats-required', () => {
  const program = (n: number) =>
    Array.from({ length: n }, (_, i) => `lesson.beat("Beat ${i + 1}");\nlesson.show(v${i});`).join('\n');

  it('does not fire when no plan beat count is supplied', () => {
    // the acceptance/spike programs are linted with no plan behind them
    const r = lint(program(0) + 'lesson.show(v);');
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => f.rule)).not.toContain('beats-required');
    expect(lint(program(3)).findings).toEqual([]);
  });

  it('errors when the plan has beats and the program declares none', () => {
    const r = lint('lesson.say`hello`;\nlesson.show(v);', { expectedBeats: 4 });
    expect(r.ok).toBe(false);
    const f = r.findings.find((x) => x.rule === 'beats-required');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('4 beats');
    expect(f?.message).toContain('lesson.beat(');
  });

  it('errors when the beat count differs materially from the plan', () => {
    const r = lint(program(2), { expectedBeats: 5 });
    expect(r.ok).toBe(false);
    const f = r.findings.find((x) => x.rule === 'beats-required');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('2 time(s)');
    expect(f?.message).toContain('5 beats');
  });

  it('passes when the beat count matches (and tolerates a drift of one)', () => {
    expect(lint(program(4), { expectedBeats: 4 }).ok).toBe(true);
    expect(lint(program(4), { expectedBeats: 4 }).findings).toEqual([]);
    expect(lint(program(3), { expectedBeats: 4 }).ok).toBe(true); // merged two beats
    expect(lint(program(5), { expectedBeats: 4 }).ok).toBe(true); // split one beat
  });

  it('does not count beats mentioned in comments or strings', () => {
    const r = lint('// lesson.beat("nope")\nconst s = `lesson.beat("also nope")`;', {
      expectedBeats: 3,
    });
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.rule)).toContain('beats-required');
  });
});
