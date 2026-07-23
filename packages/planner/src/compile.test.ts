import { describe, expect, it } from 'vitest';
import { compileProgram, compileResponse, extractProgram } from './compile.js';
import { EXAMPLE_PROGRAMS } from './examples.generated.js';

const OK = `
const f = Calc.fn((t: number) => 0.5 * t + 1, { label: "f" });
lesson.say\`Here is \${f}.\`;
`;

describe('extractProgram', () => {
  it('pulls the program out of a fenced block', () => {
    expect(extractProgram('Sure:\n```ts\nlesson.say`hi`;\n```\nDone.')).toBe('lesson.say`hi`;');
  });

  it('takes the longest block when the model also shows a snippet', () => {
    const raw = '```ts\nconst a = 1;\n```\ntext\n```ts\nlesson.show(a);\nlesson.hide(a);\n```';
    expect(extractProgram(raw)).toBe('lesson.show(a);\nlesson.hide(a);');
  });

  it('accepts an unfenced response that is plainly a program', () => {
    expect(extractProgram('lesson.say`hi`;')).toBe('lesson.say`hi`;');
  });

  it('rejects prose', () => {
    expect(extractProgram('I think the answer is 4.')).toBeNull();
  });
});

describe('the gate', () => {
  it('accepts a well-formed program and strips its types', async () => {
    const r = await compileProgram(OK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.program.js).not.toContain(': number');
    expect(r.program.js).toContain('0.5');
    expect(r.program.source).toBe(OK);
  });

  it('rejects imports — the scope arrives as ambient globals', async () => {
    const r = await compileProgram('import { M } from "./api";\nlesson.say`hi`;');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe('shape');
    expect(r.errors[0]).toMatch(/must not import/);
  });

  it('rejects a program that authors no timeline', async () => {
    const r = await compileProgram('const f = Calc.fn((t: number) => t);');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe('shape');
    expect(r.errors[0]).toMatch(/never calls a `lesson\.\*` verb/);
  });

  it('reports a syntax error with a line number', async () => {
    const r = await compileProgram('lesson.say`hi`;\nconst x = (1 + ;\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe('syntax');
    expect(r.errors[0]).toMatch(/^line 2:/);
  });

  it('fails lint on a sandbox escape', async () => {
    const r = await compileProgram('lesson.say`hi`;\nconst g = eval("1+1");');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe('lint');
    expect(r.errors.join()).toMatch(/eval/);
  });

  it('passes nondeterminism through as a WARNING, not a rejection', async () => {
    const r = await compileProgram('lesson.say`hi`;\nconst n = Math.random();');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.program.findings.some((f) => f.severity === 'warning')).toBe(true);
  });

  it('compiles straight from a raw model response', async () => {
    const r = await compileResponse('Here you go:\n```ts\n' + OK + '\n```');
    expect(r.ok).toBe(true);
  });

  it('reports an extraction failure distinctly', async () => {
    const r = await compileResponse('The determinant is the area scaling factor.');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe('extract');
  });
});

// Whatever examples/manifest.json currently lists — these are the programs we
// SHOW the model. If our own gate rejects one, the gate is wrong: we would be
// handing the model a worked example we would then refuse from it. This loops
// over the manifest, so rewriting or adding an example needs no edit here.
describe('the known-good programs survive the gate', () => {
  for (const [key, example] of Object.entries(EXAMPLE_PROGRAMS)) {
    it(`${key} (examples/${example.dir})`, async () => {
      const r = await compileProgram(example.source);
      if (!r.ok) throw new Error(`${r.stage}: ${r.errors.join('; ')}`);
      expect(r.program.js.length).toBeGreaterThan(100);
      expect(r.program.findings.filter((f) => f.severity === 'error')).toHaveLength(0);
    });
  }

  // The gallery ships pre-stripped JS so it needs no server and no API key.
  // That is a second copy of the transform options, so pin them together.
  it('ships JS identical to what the gate would produce', async () => {
    for (const example of Object.values(EXAMPLE_PROGRAMS)) {
      const r = await compileProgram(example.source);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(example.js).toBe(r.program.js);
    }
  });

  it('strips the ./api import that the examples carry', () => {
    for (const example of Object.values(EXAMPLE_PROGRAMS)) {
      expect(example.source).not.toMatch(/^\s*import\s/m);
    }
  });
});
