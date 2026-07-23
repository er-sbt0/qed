/**
 * tool-defs.test.ts — the declaration/parse half of the tool loop.
 *
 * The contract under test: every tool the host implements is declared, a
 * declared call round-trips through the parser into the host's `ToolCall`
 * shape, and the three-way read (call / prose / malformed) errs on the side
 * that keeps the loop alive — a botched call is malformed and fed back, never
 * mistaken for a final prose answer.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_DEFS, parseToolReply, renderToolDefs } from './tool-defs.js';

const fenced = (json: string, extra = ''): string =>
  `Let me check.\n\n\`\`\`json\n${json}\n\`\`\`\n${extra}`;

describe('the declarations', () => {
  it('declare exactly the seven tools the host implements', () => {
    expect(TOOL_DEFS.map((t) => t.name)).toEqual([
      'inspect',
      'evalAt',
      'whyChanged',
      'counterfactual',
      'bisectFlip',
      'setInput',
      'appendFragment',
    ]);
  });

  it('render each tool with its call shape and its meaning', () => {
    const text = renderToolDefs();
    for (const t of TOOL_DEFS) {
      expect(text).toContain(`${t.name} — `);
      expect(text).toContain(t.call.split('\n')[0]!);
    }
    // the two rules the descriptions exist to carry
    expect(text).toContain('why did that turn red?'); // whyChanged is THE probe
    expect(text).toContain('fix exactly what it names'); // gate retry, not workaround
  });
});

describe('parseToolReply — a call', () => {
  it('reads a fenced json block into a typed call', () => {
    const r = parseToolReply(fenced('{"tool": "whyChanged", "id": "claim#2"}'));
    expect(r).toEqual({ kind: 'call', call: { tool: 'whyChanged', id: 'claim#2' } });
  });

  it('reads every declared shape', () => {
    const calls = [
      { tool: 'inspect', id: 'matrix#1' },
      { tool: 'evalAt', id: 'vectorField#1', args: [1, -1] },
      { tool: 'counterfactual', set: [{ id: 'parameter#1', value: 5 }], read: ['claim#2'] },
      { tool: 'bisectFlip', param: 'parameter#1', claim: 'claim#2', lo: -2, hi: 2 },
      { tool: 'setInput', id: 'parameter#1', value: 0 },
    ];
    for (const call of calls) {
      expect(parseToolReply(fenced(JSON.stringify(call)))).toEqual({ kind: 'call', call });
    }
  });

  it('appendFragment lifts its source from the sibling ts fence', () => {
    const reply = fenced(
      '{"tool": "appendFragment"}',
      '\n```ts\nconst k = M.byId("parameter#1");\nlesson.beat("Push further");\nlesson.say`now ${k}`;\n```\n',
    );
    const r = parseToolReply(reply);
    expect(r.kind).toBe('call');
    if (r.kind === 'call' && r.call.tool === 'appendFragment') {
      expect(r.call.source).toContain('M.byId("parameter#1")');
      expect(r.call.source).toContain('lesson.beat');
      // the json block itself must not leak into the program
      expect(r.call.source).not.toContain('"tool"');
    }
  });

  it('appendFragment still accepts an inline source string', () => {
    const r = parseToolReply(
      fenced('{"tool": "appendFragment", "source": "lesson.beat(\\"x\\");"}'),
    );
    expect(r).toEqual({
      kind: 'call',
      call: { tool: 'appendFragment', source: 'lesson.beat("x");' },
    });
  });
});

describe('parseToolReply — prose', () => {
  it('a plain answer is prose, trimmed', () => {
    const r = parseToolReply('  The claim flips at spin = 1.5 — the engine bisected it.  ');
    expect(r).toEqual({
      kind: 'prose',
      prose: 'The claim flips at spin = 1.5 — the engine bisected it.',
    });
  });

  it('prose that quotes JSON without a "tool" key stays prose', () => {
    const r = parseToolReply(fenced('{"holds": false, "gap": 1}'));
    expect(r.kind).toBe('prose');
  });
});

describe('parseToolReply — malformed keeps the loop alive', () => {
  it('an unknown tool name is malformed, and the message lists the real ones', () => {
    const r = parseToolReply(fenced('{"tool": "interrogate", "id": "claim#2"}'));
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') expect(r.message).toContain('whyChanged');
  });

  it('a known tool with wrong args is malformed, and the message shows the shape', () => {
    const r = parseToolReply(fenced('{"tool": "bisectFlip", "param": "p#1", "claim": "c#1"}'));
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') {
      expect(r.message).toContain('lo');
      expect(r.message).toContain('{"tool": "bisectFlip"');
    }
  });

  it('a json block that meant to call a tool but does not parse is malformed, not prose', () => {
    const r = parseToolReply(fenced('{"tool": "inspect", "id": }'));
    expect(r.kind).toBe('malformed');
  });

  it('appendFragment with no source anywhere is malformed and says where to put it', () => {
    const r = parseToolReply(fenced('{"tool": "appendFragment"}'));
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') expect(r.message).toContain('fenced ts block');
  });
});
