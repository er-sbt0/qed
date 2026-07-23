/**
 * @math-ai/core — identity, values, reactivity, correspondence, timeline.
 *
 * Milestone 1 of the build order in docs/architecture.md. The kernel verbs
 * (milestone 2), renderers (3), discipline libraries (4), and the QuickJS
 * host (5) are built on top of this surface without changing it.
 */

export { isHandle, IdRegistry } from './identity.js';
export type { Handle, Id, IdCounters } from './identity.js';

export { CorrespondenceGraph } from './correspondence.js';
export type {
  Relation,
  EdgeOrigin,
  CorrespondenceEdge,
  ReachOpts,
} from './correspondence.js';

export { Timeline } from './timeline.js';
export type {
  Pace,
  PaceRate,
  Step,
  TimelineNode,
  ActionStep,
  CascadeStep,
  ParallelStep,
  LoopStep,
  StepOpts,
  TimelineHost,
} from './timeline.js';

export { Slot, Collection, Derived, Incremental } from './reactive.js';
export type {
  Equals,
  Unsubscribe,
  ReactiveHost,
  SlotTransition,
  SetOpts,
  CollectionDelta,
  DerivedChange,
  IncrementalOpts,
  IncrementalChange,
} from './reactive.js';

export type {
  Provenance,
  TraceEvent,
  OpContext,
  OpBody,
  Operation,
  OpDefOpts,
} from './provenance.js';

export { World, createWorld } from './world.js';
