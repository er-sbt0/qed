/**
 * @math-ai/host — milestone 5: the QuickJS host. The same lesson programs that
 * ran in-process at milestone 4 now execute as SANDBOXED guest code:
 *
 *  - `Bridge` marshals the program scope — the guest sees handles + method
 *    stubs, all state stays host-side (decision #2 payoff, M4's recommended
 *    cut, validated).
 *  - `FrameBudget` / `degradeFrame` enforce the per-frame interrupt budget:
 *    interaction-time failure degrades (freeze / clamp), never fails the
 *    answer.
 *  - `lint` is the fail-fast static gate at generation time.
 *  - `QuickJSHost` ties them together; `newNodeContext` (from
 *    `@math-ai/host/node` in tests) or the browser's single-file wasm variant
 *    provides the context.
 */

export { QuickJSHost, LintError } from './host.js';
export type { HostOpts } from './host.js';
export { Bridge } from './bridge.js';
export type { BridgeHooks } from './bridge.js';
export { FrameBudget, degradeFrame } from './budget.js';
export type { BudgetOpts, FrameStatus, FrameResult } from './budget.js';
export { lint } from './lint.js';
export type { LintFinding, LintOptions, LintResult } from './lint.js';
export { GUEST_PRELUDE } from './prelude.js';
export { GuestError } from './protocol.js';
export type { WireNode, HostCall } from './protocol.js';
export { describeGuestError } from './guest-error.js';
export { replayLog, commitEntry, foldSource, studentEvents, coalesce, isolate } from './conversation.js';
export type {
  ConversationLog,
  LogEntry,
  ProgramEntry,
  FragmentEntry,
  EventEntry,
  StudentEvent,
  SetInputEvent,
  ReplayHooks,
  ReplayResult,
  ReplayFailure,
  CommitResult,
  Settable,
} from './conversation.js';
export type { GuestSite, GuestErrorDetail } from './guest-error.js';
export { runTool, inspect, evalAt, whyChanged, counterfactual, bisectFlip } from './tools.js';
export type {
  ToolCall,
  ToolResult,
  ToolError,
  ToolErrorCode,
  ToolHooks,
  ToolOutcome,
  SceneMap,
  SetSpec,
  FoldScene,
  FoldOutcome,
  CompileFragment,
  WhyChangedEntry,
  Json,
} from './tools.js';
