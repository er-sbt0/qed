/**
 * model.ts — the model boundary, behind one small interface.
 *
 * Everything above this file (planning, program generation, the gate, repair)
 * is deterministic given a `ModelClient`, so the whole pipeline is testable
 * with a scripted client and no API key. `anthropicClient()` is the only place
 * the SDK is touched.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod/v4';

export const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 16_384;

export interface ModelTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ModelTurn[];
  readonly maxTokens?: number;
}

export interface ModelClient {
  complete(req: ModelRequest): Promise<string>;
}

/** Thrown when the model's output is unusable before any gate sees it. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

export function anthropicClient(sdk = new Anthropic()): ModelClient {
  return {
    async complete(req: ModelRequest): Promise<string> {
      const msg = await sdk.messages.create({
        model: MODEL,
        max_tokens: req.maxTokens ?? MAX_TOKENS,
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      if (msg.stop_reason === 'max_tokens') {
        throw new ModelOutputError(
          'model output truncated (stop_reason=max_tokens) — the program would be incomplete',
        );
      }
      const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
      if (text == null) throw new ModelOutputError('model returned no text output');
      return text;
    },
  };
}

/**
 * Slice the first balanced top-level JSON object out of `raw`, ignoring braces
 * inside strings — so stray prose or a code fence around the object costs no
 * round-trip.
 */
export function sliceJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  if (start === -1) throw new ModelOutputError('model returned no JSON object');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return raw.slice(start, i + 1);
  }
  throw new ModelOutputError('model returned an unterminated JSON object');
}

/** One JSON-returning call, parsed and schema-validated. */
export async function completeJSON<S extends z.ZodType>(
  client: ModelClient,
  schema: S,
  req: ModelRequest,
): Promise<z.infer<S>> {
  const raw = await client.complete(req);
  let data: unknown;
  try {
    data = JSON.parse(sliceJsonObject(raw));
  } catch (e) {
    if (e instanceof ModelOutputError) throw e;
    throw new ModelOutputError(`model output was not valid JSON: ${(e as Error).message}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ModelOutputError(
      'model output did not match the schema:\n- ' +
        parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('\n- '),
    );
  }
  return parsed.data;
}
