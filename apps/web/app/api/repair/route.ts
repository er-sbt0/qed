/**
 * POST /api/repair — the runtime half of the gate.
 *
 * A program can pass every static check and still throw at authoring time or on
 * frame 200 of a drag; the architecture calls this the critical engineering
 * problem, and the determinant spike is the proof (it linked a formula span
 * role it never declared, which only execution could catch). The browser posts
 * the diagnostic back here and gets one corrected program.
 *
 * This is a repair round-trip, not a retry loop: one attempt, then an honest
 * failure. The client keeps the last good render either way.
 */

import { AnswerPlanSchema, anthropicClient, repairProgram } from '@math-ai/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }, { status: 503 });
  }

  let body: { question?: unknown; plan?: unknown; source?: unknown; errors?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const plan = AnswerPlanSchema.safeParse(body.plan);
  if (
    typeof body.question !== 'string' ||
    typeof body.source !== 'string' ||
    !Array.isArray(body.errors) ||
    body.errors.some((e) => typeof e !== 'string') ||
    !plan.success
  ) {
    return Response.json(
      { error: '"question", "plan", "source", and string "errors" are required' },
      { status: 400 },
    );
  }

  try {
    const result = await repairProgram(
      anthropicClient(),
      body.question,
      plan.data,
      body.source,
      body.errors as string[],
    );
    return Response.json({
      program: result.program
        ? { source: result.program.source, js: result.program.js, findings: result.program.findings }
        : null,
      failure: result.failure ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unexpected error';
    return Response.json({ error: message }, { status: 500 });
  }
}
