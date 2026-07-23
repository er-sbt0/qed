/**
 * loop.ts — the agentic turn (roadmap 4c): one conversational call, the scene
 * exposed as typed tools, the model choosing its own acts.
 *
 * The driver is deliberately dumb. Everything with judgement in it lives
 * elsewhere and arrives injected: the model behind `ModelClient` (so a
 * scripted client or a cassette replays the loop for free), tool EXECUTION
 * behind `ToolExecutor` (the only legal implementation wraps
 * `@math-ai/host`'s `runTool` with `sceneIndex` — this package stays
 * browser-free and never resolves an id itself), and the decision of when to
 * stop with the model, which stops by replying prose.
 *
 * ## The classifier still runs first
 *
 * "set a = 0" is an event, not a conversation. `classifyFollowup` decides it
 * locally against the manifest's draggables, and a classified manipulate is
 * dispatched straight to the executor — zero model calls, same as 4b. Only
 * unclassified turns reach the model at all.
 *
 * ## The caps are typed outcomes, not exceptions
 *
 * A model that probes forever, or re-submits a rejected fragment forever, is
 * a real possibility the loop must survive without a human watching. Both
 * caps return a `gave-up` outcome carrying everything the turn DID do — the
 * acts and the (possibly advanced) log are evidence even when the prose never
 * arrived, and the caller decides what to show the student.
 */

import type { ConversationLog, ToolCall, ToolOutcome, ToolResult } from '@math-ai/host';
import { classifyFollowup, type ManipulableTarget } from './intent.js';
import type { ModelClient, ModelTurn } from './model.js';
import type { AnswerPlan, Discipline } from './plan.js';
import { toolLoopBrief, toolLoopSystem } from './prompts.js';
import { parseToolReply } from './tool-defs.js';

/**
 * The conversation as the thing a caller PERSISTS: the log (which replays the
 * scene), plus the plan the lesson was generated from and the question it
 * answers (which replay cannot reconstruct — they were inputs to generation,
 * not acts in the scene). 4a/4b discarded the plan after generation, so the
 * follow-up model saw the narration but never the argument; carrying it here
 * is what fixes that. The loop reads it, never writes it: writes advance the
 * LOG, and the outcome hands the advanced log back for the caller to re-wrap.
 */
export interface ConversationArtifact {
  readonly log: ConversationLog;
  readonly plan?: AnswerPlan;
  readonly originalQuestion?: string;
}

/**
 * Tool execution, injected. Stateless on purpose: the loop owns the advancing
 * log and hands the current one in per call, so an executor is just `runTool`
 * with the hooks closed over — no session object to keep alive between calls.
 */
export type ToolExecutor = (
  call: ToolCall,
  log: ConversationLog,
) => Promise<ToolOutcome> | ToolOutcome;

/** One act the turn took: what was asked of the scene, and what came back. */
export interface LoopAct {
  readonly call: ToolCall;
  readonly result: ToolResult;
}

export interface ToolLoopOpts {
  readonly question: string;
  /** The scene as it stands — `sceneManifest(stage)`, posted up by the client. */
  readonly manifest: unknown;
  /** The conversation so far; writes advance its log, and the outcome carries it. */
  readonly conversation: ConversationArtifact;
  /** The transition since the last question — `transitionFeed(...)`. */
  readonly feed?: unknown;
  readonly disciplines?: readonly Discipline[];
  /** Tool-call rounds (dispatched or malformed) before giving up. Default 16. */
  readonly maxToolCalls?: number;
  /** appendFragment rejections before giving up. Default 3. */
  readonly maxFragmentRejections?: number;
}

interface LoopTrace {
  /** The conversation log after the turn — advanced only by committed writes. */
  readonly log: ConversationLog;
  readonly acts: readonly LoopAct[];
  /** Model completions spent. 0 on the classifier's fast path. */
  readonly modelCalls: number;
  /** The model↔tool transcript, for cassettes and for carrying context forward. */
  readonly messages: readonly ModelTurn[];
}

export type LoopOutcome =
  /** The model finished with prose. The normal ending. */
  | ({ readonly kind: 'answered'; readonly prose: string } & LoopTrace)
  /** classifyFollowup decided locally; the model was never consulted. */
  | ({ readonly kind: 'manipulated' } & LoopTrace)
  /** A hard cap fired. Everything the turn did do is still here. */
  | ({
      readonly kind: 'gave-up';
      readonly reason: 'tool-cap' | 'fragment-retries';
      readonly detail: string;
    } & LoopTrace)
  /** The model seam itself failed (threw). The turn's acts survive. */
  | ({ readonly kind: 'failed'; readonly detail: string } & LoopTrace);

const DEFAULT_MAX_TOOL_CALLS = 16;
const DEFAULT_MAX_FRAGMENT_REJECTIONS = 3;
/** A turn's replies are a tool call or a few sentences — never a program dump. */
const LOOP_MAX_TOKENS = 4096;

/**
 * The manifest's draggables, read structurally. The manifest crosses this
 * seam as `unknown` (it is built in the browser and posted up), so the loop
 * duck-types exactly the fields `classifyFollowup` needs and nothing else —
 * a manifest without them simply yields no fast path.
 */
export function manipulableTargets(manifest: unknown): readonly ManipulableTarget[] {
  const objects = (manifest as { objects?: unknown } | null)?.objects;
  if (!Array.isArray(objects)) return [];
  const out: ManipulableTarget[] = [];
  for (const o of objects) {
    if (o === null || typeof o !== 'object') continue;
    const { id, label, range, draggable } = o as {
      id?: unknown;
      label?: unknown;
      range?: unknown;
      draggable?: unknown;
    };
    if (draggable !== true || typeof id !== 'string') continue;
    const bounds =
      Array.isArray(range) && typeof range[0] === 'number' && typeof range[1] === 'number'
        ? ([range[0], range[1]] as const)
        : undefined;
    out.push({
      id,
      ...(typeof label === 'string' ? { label } : {}),
      ...(bounds ? { range: bounds } : {}),
    });
  }
  return out;
}

/** How a result reads back to the model. The error text IS the retry prompt. */
function resultMessage(tool: string, result: ToolResult): string {
  return `TOOL RESULT (${tool}):

\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

Call another tool, or answer the student in prose.`;
}

const badCall = (message: string): ToolResult => ({
  ok: false,
  error: { code: 'bad-args', message },
});

/**
 * Run one agentic turn. Terminates on a prose-only reply, a cap, or a model
 * seam failure — never on a tool error, which goes back to the model as data.
 */
export async function runToolLoop(
  client: ModelClient,
  execute: ToolExecutor,
  opts: ToolLoopOpts,
): Promise<LoopOutcome> {
  const conversation = opts.conversation;

  // ── the free fast path: a locally classified manipulate never reaches the model ──
  const classified = classifyFollowup(opts.question, manipulableTargets(opts.manifest));
  if (classified.intent === 'manipulate') {
    const call: ToolCall = {
      tool: 'setInput',
      id: classified.target.id,
      value: classified.value,
    };
    const outcome = await execute(call, conversation.log);
    return {
      kind: 'manipulated',
      log: outcome.log ?? conversation.log,
      acts: [{ call, result: outcome.result }],
      modelCalls: 0,
      messages: [],
    };
  }

  const system = toolLoopSystem(opts.disciplines ?? []);
  const messages: ModelTurn[] = [
    {
      role: 'user',
      content: toolLoopBrief(opts.manifest, opts.question, {
        ...(conversation.plan !== undefined ? { plan: conversation.plan } : {}),
        ...(opts.feed !== undefined ? { feed: opts.feed } : {}),
        ...(conversation.originalQuestion !== undefined
          ? { original: conversation.originalQuestion }
          : {}),
      }),
    },
  ];

  const maxCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxRejections = opts.maxFragmentRejections ?? DEFAULT_MAX_FRAGMENT_REJECTIONS;
  let log = conversation.log;
  const acts: LoopAct[] = [];
  let modelCalls = 0;
  let calls = 0;
  let rejections = 0;

  const trace = (): LoopTrace => ({ log, acts, modelCalls, messages });

  for (;;) {
    let raw: string;
    try {
      // Snapshot: a recorder holds the request past this call, and handing it
      // the live array would show every earlier request the FINAL transcript.
      raw = await client.complete({ system, messages: [...messages], maxTokens: LOOP_MAX_TOKENS });
    } catch (e) {
      return {
        kind: 'failed',
        detail: e instanceof Error ? e.message : String(e),
        ...trace(),
      };
    }
    modelCalls += 1;

    const parsed = parseToolReply(raw);
    if (parsed.kind === 'prose') {
      return { kind: 'answered', prose: parsed.prose, ...trace() };
    }

    messages.push({ role: 'assistant', content: raw });
    calls += 1;

    let tool: string;
    let result: ToolResult;
    if (parsed.kind === 'malformed') {
      // A malformed call spends a round (the cap must bind a model that only
      // babbles) but is not an act — nothing reached the scene.
      tool = 'unparseable call';
      result = badCall(parsed.message);
    } else {
      const outcome = await execute(parsed.call, log);
      result = outcome.result;
      log = outcome.log ?? log;
      acts.push({ call: parsed.call, result });
      tool = parsed.call.tool;
      if (parsed.call.tool === 'appendFragment' && !result.ok) {
        rejections += 1;
        if (rejections >= maxRejections) {
          return {
            kind: 'gave-up',
            reason: 'fragment-retries',
            detail:
              `the gate rejected ${rejections} fragment(s) in this turn; the last complaint: ` +
              result.error.message,
            ...trace(),
          };
        }
      }
    }

    if (calls >= maxCalls) {
      return {
        kind: 'gave-up',
        reason: 'tool-cap',
        detail: `the model was still calling tools after ${calls} rounds and never answered`,
        ...trace(),
      };
    }
    messages.push({ role: 'user', content: resultMessage(tool, result) });
  }
}
