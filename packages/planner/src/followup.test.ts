/**
 * followup.test.ts — the read-only conversational pass (roadmap step 4a).
 *
 * What is free to prove here is the CONTRACT, not the answer: that the scene
 * reaches the model at all, that the honesty rules the manifest exists to
 * enforce are actually in the system prompt, and that nothing on this path can
 * mutate the scene. Whether the model then answers "why did that turn red?"
 * correctly is a billed question, and the roadmap keeps it as this step's exit
 * criterion rather than pretending a scripted client answers it.
 */

import { describe, expect, it } from 'vitest';
import { answerFollowup } from './generate.js';
import { FOLLOWUP_SYSTEM, followupBrief } from './prompts.js';
import type { ModelClient, ModelRequest } from './model.js';

const MANIFEST = {
  beats: [{ index: 0, title: 'A field that swirls' }],
  narration: ['The field turns with …'],
  views: [{ id: 'view:field#1', kind: 'view:field', shown: true, projects: ['vectorField#1'] }],
  objects: [
    { id: 'parameter#1', kind: 'parameter', label: 'spin', value: -1.5, range: [-2, 2], draggable: true },
    { id: 'scalar#7', kind: 'scalar', label: '\\oint F\\cdot dr', value: -6 },
  ],
  claims: [
    {
      id: 'claim#1',
      label: 'the circulation runs counterclockwise',
      holds: false,
      evidence: 'authored-predicate',
    },
  ],
};

function scripted(reply: string): { client: ModelClient; seen: ModelRequest[] } {
  const seen: ModelRequest[] = [];
  return {
    seen,
    client: {
      async complete(req: ModelRequest): Promise<string> {
        seen.push(req);
        return reply;
      },
    },
  };
}

describe('answerFollowup', () => {
  it('sends the whole scene, the question, and nothing else', async () => {
    const { client, seen } = scripted('  You dragged spin negative.  ');
    const answer = await answerFollowup(client, MANIFEST, 'why did that turn red?');

    expect(answer).toBe('You dragged spin negative.'); // trimmed
    expect(seen).toHaveLength(1); // ONE call — no plan pass, no gate, no repair
    const [req] = seen;
    expect(req!.system).toBe(FOLLOWUP_SYSTEM);
    expect(req!.messages).toHaveLength(1);
    expect(req!.messages[0]!.role).toBe('user');

    const sent = req!.messages[0]!.content;
    expect(sent).toContain('why did that turn red?');
    // the dragged value, the broken verdict, and the ids are all in the prompt
    expect(sent).toContain('-1.5');
    expect(sent).toContain('"holds": false');
    expect(sent).toContain('claim#1');
  });

  it('carries the original question when there is one, and omits it when there is not', () => {
    expect(followupBrief(MANIFEST, 'q', "Why does Green's theorem work?")).toContain(
      "The lesson answers: Why does Green's theorem work?",
    );
    expect(followupBrief(MANIFEST, 'q')).not.toContain('The lesson answers');
  });

  it('the manifest is valid JSON inside the brief, not a stringified object', () => {
    const brief = followupBrief(MANIFEST, 'q');
    const json = brief.slice(brief.indexOf('```json') + 7, brief.lastIndexOf('```'));
    expect(JSON.parse(json)).toEqual(MANIFEST);
  });
});

describe('the honesty rules — the reason step 4a exists at all', () => {
  it('the prompt names all three evidence kinds and what each is worth', () => {
    for (const kind of ['exact-comparison', 'sampled', 'authored-predicate']) {
      expect(FOLLOWUP_SYSTEM).toContain(kind);
    }
    // and specifically forbids the two overstatements a manifest invites
    expect(FOLLOWUP_SYSTEM.toLowerCase()).toContain('never call this a proof');
    expect(FOLLOWUP_SYSTEM).toContain('EVIDENCE, not proof');
  });

  it('the prompt forbids answering from outside the manifest', () => {
    expect(FOLLOWUP_SYSTEM).toContain('do not guess a');
  });

  it('the pass is read-only, and says so to the model', () => {
    expect(FOLLOWUP_SYSTEM).toContain('Change nothing');
    expect(FOLLOWUP_SYSTEM).toContain('prose only');
  });
});
