/**
 * tool-defs.ts — the 4c tools, declared for the model (roadmap 4c).
 *
 * The tool layer lives in `@math-ai/host/tools.ts`; this file is its other
 * half: what the MODEL is told about each tool, and how a model reply is read
 * back into a typed `ToolCall`. The two halves must agree on names and shapes,
 * which is why `ToolCall` is imported rather than restated.
 *
 * ## Why tool calls travel as text
 *
 * `ModelClient.complete` is string → string, and the cassette machinery replays
 * exactly those strings keyed on call order. Expressing a tool call as a fenced
 * JSON block inside an ordinary completion keeps the loop on the SAME seam as
 * every other pass — a recorded agentic turn replays with `replayClient`-shaped
 * machinery unchanged, and no SDK tool-use plumbing enters the boundary. The
 * price is a parser, and the parser is here.
 *
 * ## appendFragment's source rides in a ts fence, not a JSON string
 *
 * A fragment is TypeScript, and `F.tex` templates are made of backslashes —
 * the same reason `compile.ts` extracts programs from fenced blocks instead of
 * JSON strings. So the protocol lets the JSON block omit `source` and carry the
 * program in a sibling ```ts fence; `extractProgram` lifts it, and its regex
 * already ignores ```json fences.
 */

import { z } from 'zod/v4';
import type { ToolCall } from '@math-ai/host';
import { extractProgram } from './compile.js';

// ─────────────────────────── the declarations ───────────────────────────

export interface ToolDef {
  readonly name: ToolCall['tool'];
  /** The call shape, JSON-schema-ish, shown to the model verbatim. */
  readonly call: string;
  /** What it answers, when to reach for it, what its typed errors mean. */
  readonly description: string;
}

export const TOOL_DEFS: readonly ToolDef[] = [
  {
    name: 'inspect',
    call: '{"tool": "inspect", "id": "<id>"}',
    description: `The full structured value of ONE object the manifest keeps terse: a matrix's
entries, a loop's vertices, a claim's two sides and the gap between them, a distribution's
weights. Reach for it before reasoning about what is inside an object. Error "unknown-id"
means the id is not in the scene — use ids verbatim from the manifest, never invent one.`,
  },
  {
    name: 'evalAt',
    call: '{"tool": "evalAt", "id": "<id>", "args": [<x>, <y>?]}',
    description: `Sample a field or function at a point: a vectorField or scalarField at (x, y),
a fn or accumulation at x. The rule evaluated is the authored closure the object itself
carries — the engine's arithmetic, not yours. Error "not-evaluable" names what evalAt can
act on; "bad-args" states the arity it wanted; "domain" means the rule is not finite there.`,
  },
  {
    name: 'whyChanged',
    call: '{"tool": "whyChanged", "id": "<id>"}',
    description: `The dependency path from a claim's verdict or a derived value back to the
inputs that move it, read off the reactive graph — causality, not narration. This is the
tool for "why did that turn red?": the chain names, in order, what the asked-about thing
depends on, ending at the root inputs. Error "not-derived" means you asked about an INPUT —
nothing upstream moves it; its history is the student's own set-input events.`,
  },
  {
    name: 'counterfactual',
    call: '{"tool": "counterfactual", "set": [{"id": "<id>", "value": <n>}], "read": ["<id>", ...]}',
    description: `"Would that claim still hold at k = 5?" — the engine folds a DISPOSABLE copy
of the scene with the sets applied, reads the requested objects there, and throws the copy
away. Nothing on screen moves. Prefer this over predicting what a value would become: the
answer comes from actually running the scene. Error "rejected" means the candidate did not
fold — the message says which act broke it.`,
  },
  {
    name: 'bisectFlip',
    call: '{"tool": "bisectFlip", "param": "<id>", "claim": "<id>", "lo": <n>, "hi": <n>}',
    description: `Binary-search the exact parameter value where a claim's verdict flips, one
disposable fold per probe. Returns the bracketing interval with the verdict at both ends —
a threshold no snapshot contains and no narration should guess. {"flipped": false} is
itself an answer: within [lo, hi] the claim never changes its mind. Use the parameter's
manifest range as the bounds unless the student asked about a narrower window.`,
  },
  {
    name: 'setInput',
    call: '{"tool": "setInput", "id": "<id>", "value": <n>}',
    description: `Set a draggable input, as the student's hands would — the value clamps to the
object's range and the act lands in the conversation log. Only objects the manifest marks
"draggable" can receive one. Error "rejected" carries the fold's complaint verbatim.`,
  },
  {
    name: 'appendFragment',
    call: '{"tool": "appendFragment"}   + the program in its own fenced ts block, same reply',
    description: `Append a program FRAGMENT to the running lesson — the write act for "show me",
"add", "what about the general case". The gate runs on the fragment and a rejection comes
back as error "rejected" with the gate's complaint verbatim: fix exactly what it names and
call appendFragment again with the corrected fragment — do not work around the gate, and do
not fall back to prose that pretends the fragment ran. Put the TypeScript in a \`\`\`ts fence
alongside the JSON block ("source" as a JSON string also works, but escaping suffers).`,
  },
];

/** The tool list as prompt text — one entry per tool, in the repo's voice. */
export function renderToolDefs(): string {
  return TOOL_DEFS.map((t) => `${t.name} — ${t.call}\n${t.description}`).join('\n\n');
}

// ─────────────────────────── reading a reply ───────────────────────────

const id = z.string().min(1);

const CallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('inspect'), id }).strict(),
  z.object({ tool: z.literal('evalAt'), id, args: z.array(z.number()) }).strict(),
  z.object({ tool: z.literal('whyChanged'), id }).strict(),
  z
    .object({
      tool: z.literal('counterfactual'),
      set: z.array(z.object({ id, value: z.number() }).strict()).min(1),
      read: z.array(id).min(1),
    })
    .strict(),
  z
    .object({
      tool: z.literal('bisectFlip'),
      param: id,
      claim: id,
      lo: z.number(),
      hi: z.number(),
      maxProbes: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ tool: z.literal('setInput'), id, value: z.number() }).strict(),
  // `source` optional: the protocol prefers the sibling ts fence (see header).
  z.object({ tool: z.literal('appendFragment'), source: z.string().optional() }).strict(),
]);

export type ParsedReply =
  | { readonly kind: 'call'; readonly call: ToolCall }
  | { readonly kind: 'prose'; readonly prose: string }
  /** A reply that tried to call a tool and failed to say which/how. The
   *  message goes back to the model as a bad-args tool result — errors are
   *  data on this path too, and the model gets to correct itself. */
  | { readonly kind: 'malformed'; readonly message: string };

/** Every fenced ```json block: its raw text, plus the parse when it has one. */
function jsonBlocks(raw: string): { text: string; parsed?: unknown; error?: string }[] {
  const fence = /```json\s*\n([\s\S]*?)```/g;
  const out: { text: string; parsed?: unknown; error?: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = fence.exec(raw)) !== null) {
    const text = m[1]!;
    try {
      out.push({ text, parsed: JSON.parse(text) });
    } catch (e) {
      out.push({ text, error: (e as Error).message });
    }
  }
  return out;
}

const hasToolKey = (x: unknown): boolean =>
  x !== null && typeof x === 'object' && typeof (x as { tool?: unknown }).tool === 'string';

/**
 * Read one model reply. The rule is deliberately narrow: only a fenced ```json
 * block whose object has a "tool" key is a tool call — prose that merely
 * mentions JSON, or quotes a result, stays prose. A reply with such a block
 * that does not validate is MALFORMED, never prose: the model plainly meant to
 * act, and treating the attempt as a final answer would end the loop on a typo.
 */
export function parseToolReply(raw: string): ParsedReply {
  const blocks = jsonBlocks(raw);
  const attempt = blocks.find((b) => hasToolKey(b.parsed));
  if (!attempt) {
    const broken = blocks.find((b) => b.error !== undefined && /"tool"/.test(b.text));
    if (broken) {
      return {
        kind: 'malformed',
        message: `the json block did not parse (${broken.error}). Reply with ONE valid fenced json block: {"tool": ...}.`,
      };
    }
    return { kind: 'prose', prose: raw.trim() };
  }

  const parsed = CallSchema.safeParse(attempt.parsed);
  if (!parsed.success) {
    const wanted = TOOL_DEFS.find(
      (t) => t.name === (attempt.parsed as { tool: string }).tool,
    );
    return {
      kind: 'malformed',
      message:
        `the tool call did not validate:\n- ` +
        parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('\n- ') +
        (wanted ? `\nThe shape is: ${wanted.call}` : `\nThe tools are: ${TOOL_DEFS.map((t) => t.name).join(', ')}.`),
    };
  }

  const call = parsed.data;
  if (call.tool === 'appendFragment' && (call.source === undefined || call.source.trim() === '')) {
    const source = extractProgram(raw.replace(/```json\s*\n[\s\S]*?```/g, ''));
    if (source === null) {
      return {
        kind: 'malformed',
        message:
          'appendFragment needs the program: put the TypeScript in its own fenced ts block ' +
          'alongside the json block (or as "source" in the JSON).',
      };
    }
    return { kind: 'call', call: { tool: 'appendFragment', source } };
  }
  return { kind: 'call', call: call as ToolCall };
}
