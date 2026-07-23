import { describe, expect, it } from 'vitest';
import { generateAnswer, generateProgram, repairProgram } from './generate.js';
import { EXAMPLE_PROGRAMS } from './examples.generated.js';
import { AnswerPlanSchema } from './plan.js';
import type { ModelClient, ModelRequest } from './model.js';

const PLAN = {
  topic: 'The determinant',
  summary: 'The determinant is the signed area scaling factor of a linear map.',
  visualize: true,
  disciplines: ['linear-algebra'],
  beats: [
    { title: 'A matrix is a transformation', claim: 'the unit square becomes a parallelogram' },
    { title: 'det is the area ratio', claim: 'the area of the image is |det|' },
  ],
};

/**
 * The realistic law-11 miss: the model outlines its beats as `//` comments
 * instead of calling lesson.beat(). Otherwise clean — the ONLY thing the gate
 * can object to here is the missing beats.
 */
const NO_BEATS =
  '```ts\n' +
  '// Beat 1: A matrix is a transformation\n' +
  'const A = LinAlg.matrix2(2, 0, 0, 1);\n' +
  'lesson.say`Meet ${A}.`;\n' +
  '// Beat 2: det is the area ratio\n' +
  'lesson.say`Its area ratio is ${A}.`;\n' +
  '```';

// one lesson.beat per PLAN beat — the gate's `beats-required` rule counts them
const GOOD =
  '```ts\n' +
  'lesson.beat("A matrix is a transformation");\n' +
  'const A = LinAlg.matrix2(2, 0, 0, 1);\n' +
  'lesson.say`Meet ${A}.`;\n' +
  'lesson.beat("det is the area ratio");\n' +
  'lesson.say`Its area ratio is ${A}.`;\n' +
  '```';

/** A client that replays a script and records what it was asked. */
function scripted(replies: string[]): ModelClient & { seen: ModelRequest[] } {
  const seen: ModelRequest[] = [];
  let i = 0;
  return {
    seen,
    async complete(req: ModelRequest): Promise<string> {
      seen.push(req);
      const reply = replies[i++];
      if (reply === undefined) throw new Error(`unscripted model call #${i}`);
      return reply;
    },
  };
}

describe('generateAnswer', () => {
  it('plans, writes one program for the whole answer, and gates it', async () => {
    const client = scripted([JSON.stringify(PLAN), GOOD]);
    const result = await generateAnswer(client, 'What is a determinant?');

    expect(result.plan.topic).toBe('The determinant');
    expect(result.explanation).toBe(PLAN.summary);
    expect(result.attempts).toBe(1);
    expect(result.program?.js).toContain('LinAlg.matrix2');
    // exactly two calls: one plan, one program — the beats are NOT a call each
    expect(client.seen).toHaveLength(2);
  });

  it('hands the beats to the program pass as one brief', async () => {
    const client = scripted([JSON.stringify(PLAN), GOOD]);
    await generateAnswer(client, 'What is a determinant?');
    const brief = client.seen[1]!.messages[0]!.content;
    expect(brief).toContain('1. A matrix is a transformation');
    expect(brief).toContain('2. det is the area ratio');
  });

  it('picks the worked example from the plan disciplines', async () => {
    // Examples are RECORDED model output and get replaced wholesale, so this
    // asserts the selection mechanism against whatever the corpus currently
    // holds — never a particular example or its prose.
    const [discipline, example] = Object.entries(EXAMPLE_PROGRAMS)[0]!;
    const client = scripted([JSON.stringify({ ...PLAN, disciplines: [discipline] }), GOOD]);
    await generateAnswer(client, 'What is a determinant?');
    expect(client.seen[1]!.system).toContain(example.title);
    expect(client.seen[1]!.system).toContain(example.source);
  });

  it('skips generation entirely when the plan says not to visualize', async () => {
    const client = scripted([JSON.stringify({ ...PLAN, visualize: false })]);
    const result = await generateAnswer(client, 'Who was Gauss?');
    expect(result.program).toBeNull();
    expect(result.explanation).toBe(PLAN.summary);
    expect(result.attempts).toBe(0);
    expect(client.seen).toHaveLength(1); // no program pass
  });
});

describe('repair', () => {
  it('feeds the gate errors back and accepts the corrected program', async () => {
    const bad = '```ts\nimport { M } from "./api";\nlesson.say`hi`;\n```';
    const client = scripted([bad, GOOD]);
    const r = await generateProgram(client, 'q', AnswerPlanSchema.parse(PLAN));

    expect(r.attempts).toBe(2);
    expect(r.program?.js).toContain('LinAlg.matrix2');
    // the repair turn carries the model's own program plus the diagnostic
    const repairTurns = client.seen[1]!.messages;
    expect(repairTurns).toHaveLength(3);
    expect(repairTurns[1]!.role).toBe('assistant');
    expect(repairTurns[2]!.content).toMatch(/must not import/);
  });

  it('gives up honestly after ONE repair instead of looping', async () => {
    const bad = '```ts\nlesson.say`hi`;\nconst g = eval("1");\n```';
    const client = scripted([bad, bad]);
    const r = await generateProgram(client, 'q', AnswerPlanSchema.parse(PLAN));

    expect(r.program).toBeNull();
    expect(r.attempts).toBe(2);
    expect(r.failure?.stage).toBe('lint');
    expect(client.seen).toHaveLength(2);
  });

  it('can be disabled, failing on the first attempt', async () => {
    const bad = '```ts\nlesson.say`hi`;\nconst g = eval("1");\n```';
    const client = scripted([bad]);
    const r = await generateProgram(client, 'q', AnswerPlanSchema.parse(PLAN), { repair: false });
    expect(r.attempts).toBe(1);
    expect(r.program).toBeNull();
  });

  it('repairs a program that outlined its beats as comments instead of calling lesson.beat', async () => {
    const client = scripted([NO_BEATS, GOOD]);
    const r = await generateProgram(client, 'q', AnswerPlanSchema.parse(PLAN));

    expect(r.attempts).toBe(2);
    expect(r.program?.js).toContain('lesson.beat("A matrix is a transformation")');

    // the gate caught it on beats alone, and said so in the repair turn
    const repairTurns = client.seen[1]!.messages;
    expect(repairTurns).toHaveLength(3);
    expect(repairTurns[2]!.content).toContain('never calls lesson.beat()');
    expect(repairTurns[2]!.content).toContain('2 beats');
  });

  it('gives up on a program that keeps omitting beats rather than looping', async () => {
    const client = scripted([NO_BEATS, NO_BEATS]);
    const r = await generateProgram(client, 'q', AnswerPlanSchema.parse(PLAN));

    expect(r.program).toBeNull();
    expect(r.attempts).toBe(2);
    expect(r.failure?.stage).toBe('lint');
    // beats are the ONLY thing wrong with it — this program is otherwise clean
    expect(r.failure?.errors).toHaveLength(1);
    expect(r.failure?.errors[0]).toContain('lesson.beat()');
    expect(client.seen).toHaveLength(2);
  });

  it('repairs a RUNTIME failure reported back from the sandbox', async () => {
    const client = scripted([GOOD]);
    const r = await repairProgram(
      client,
      'What is a determinant?',
      AnswerPlanSchema.parse(PLAN),
      'lesson.link(f.span("missing"), A, "represents");',
      ['formula has no span with role "missing"'],
    );
    expect(r.program?.js).toContain('LinAlg.matrix2');
    const msgs = client.seen[0]!.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[2]!.content).toContain('failed while executing in the sandbox');
    expect(msgs[2]!.content).toContain('no span with role "missing"');
  });
});
