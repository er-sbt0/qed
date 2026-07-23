/**
 * POST /api/followup — the read-only conversational turn (roadmap step 4a).
 *
 * The student asks something about the lesson already on their screen. The
 * browser posts up a SCENE MANIFEST — what exists right now, including
 * everything they have dragged — and gets prose back. Nothing is generated,
 * nothing is gated, nothing in the scene moves.
 *
 * The manifest necessarily comes from the client: the world only exists in the
 * browser (the program ran in a QuickJS sandbox against a host-side world
 * there), so there is nothing on the server to describe. That is the same
 * shape as /api/repair, which takes the runtime `errors[]` the client saw, and
 * it keeps this route stateless — a conversation stays replayable from its
 * inputs instead of from a long-lived session.
 *
 * The WRITE path (a turn that appends a program fragment or a student event to
 * the scene) is step 4b and deliberately is not here yet. Splitting them is
 * what lets the manifest be tested in isolation before anything can mutate.
 */

import { answerFollowup, anthropicClient } from '@math-ai/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A manifest is prompt text in the end; refuse an unreasonable one rather than bill for it. */
const MAX_MANIFEST_BYTES = 200_000;

export async function POST(req: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }, { status: 503 });
  }

  let body: { question?: unknown; manifest?: unknown; originalQuestion?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body.question !== 'string' ||
    body.question.trim() === '' ||
    body.manifest === null ||
    typeof body.manifest !== 'object'
  ) {
    return Response.json(
      { error: '"question" (non-empty string) and "manifest" (object) are required' },
      { status: 400 },
    );
  }
  if (JSON.stringify(body.manifest).length > MAX_MANIFEST_BYTES) {
    return Response.json({ error: 'manifest too large' }, { status: 413 });
  }

  try {
    const answer = await answerFollowup(anthropicClient(), body.manifest, body.question, {
      originalQuestion: typeof body.originalQuestion === 'string' ? body.originalQuestion : undefined,
    });
    return Response.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unexpected error';
    return Response.json({ error: message }, { status: 500 });
  }
}
