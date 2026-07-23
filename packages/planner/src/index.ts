/**
 * @math-ai/planner — milestone 7: the planner swap.
 *
 * The generation layer above the engine. `AnswerPlan` survives from the old
 * harness as the steering and inspection point (decision #11); everything below
 * it is new: the per-answer payload is a LESSON PROGRAM, and the Zod scene gate
 * is now `extract -> shape -> syntax -> lint` plus runtime diagnostics from the
 * sandbox.
 *
 * It lives in a package rather than in the web app's API route so the pipeline
 * is testable without Next and without an API key (see `ModelClient`).
 */

export { AnswerPlanSchema, BeatSchema, DISCIPLINES, validateAnswerPlan } from './plan.js';
export type { AnswerPlan, Beat, Discipline, PlanValidation } from './plan.js';

export {
  compileProgram,
  compileResponse,
  compileFragment,
  compileFragmentResponse,
  extractProgram,
} from './compile.js';
export type { CompiledProgram, CompileOpts, CompileResult } from './compile.js';

export { anthropicClient, completeJSON, sliceJsonObject, ModelOutputError, MODEL } from './model.js';
export type { ModelClient, ModelRequest, ModelTurn } from './model.js';

export {
  answerFollowup,
  generateAnswer,
  generateFragment,
  generateProgram,
  planAnswer,
  repairProgram,
} from './generate.js';
export type { AnswerResult, GenerateOpts } from './generate.js';

export {
  FOLLOWUP_SYSTEM,
  PLAN_SYSTEM,
  followupBrief,
  fragmentBrief,
  fragmentSystem,
  programBrief,
  programSystem,
  repairBrief,
} from './prompts.js';
export { classifyFollowup } from './intent.js';
export type { FollowupIntent, IntentResult, ManipulateIntent, ManipulableTarget } from './intent.js';

// the agentic turn (roadmap 4c): prompt, driver, cassettes
export { toolLoopBrief, toolLoopSystem } from './prompts.js';
export { TOOL_DEFS, parseToolReply, renderToolDefs } from './tool-defs.js';
export type { ParsedReply, ToolDef } from './tool-defs.js';
export { manipulableTargets, runToolLoop } from './loop.js';
export type { ConversationArtifact, LoopAct, LoopOutcome, ToolExecutor, ToolLoopOpts } from './loop.js';
export { LoopCassetteExhaustedError, recordToolLoop, replayToolLoop } from './loop-cassette.js';
export type { LoopCassette, LoopCassetteTurn, LoopReplayResult } from './loop-cassette.js';
export { API_REFERENCE } from './api-reference.js';
export { EXAMPLE_PROGRAMS } from './examples.generated.js';
export type { ExampleProgram } from './examples.generated.js';
