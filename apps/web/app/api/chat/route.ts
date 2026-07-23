/**
 * POST /api/chat — plan the answer, write ONE lesson program, gate it.
 *
 * The route is deliberately thin: the pipeline lives in `@math-ai/planner`,
 * which is testable without Next and without an API key. What crosses the wire
 * is the artifact itself (the program) plus the plan that steered it — the
 * client executes the program in its own sandbox.
 */

import { anthropicClient, generateAnswer } from '@math-ai/planner';

// The Anthropic SDK and esbuild's transform both need the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY is not set on the server. Add it to apps/web/.env.local.' },
      { status: 503 },
    );
  }

  let question: unknown;
  try {
    ({ question } = await req.json());
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof question !== 'string' || question.trim().length === 0) {
    return Response.json({ error: 'a non-empty "question" is required' }, { status: 400 });
  }

  try {
    const result = await generateAnswer(anthropicClient(), question.trim());
    return Response.json({
      plan: result.plan,
      explanation: result.explanation,
      program: result.program
        ? { source: result.program.source, js: result.program.js, findings: result.program.findings }
        : null,
      failure: result.failure ?? null,
      attempts: result.attempts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unexpected error';
    return Response.json({ error: message }, { status: 500 });
  }
}
