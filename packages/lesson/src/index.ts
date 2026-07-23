/**
 * @math-ai/lesson — milestone 2: the 13 kernel verbs as timeline-step
 * operations over `@math-ai/core`.
 *
 * `createLesson(world)` yields the `lesson.*` authoring surface every lesson
 * program is written against — the engine-owned fixture, the recorded examples
 * under examples/, and whatever the model emits next. No rendering: every verb
 * produces step payloads (types.ts) that milestone 3's renderer consumes.
 */

export { Lesson, createLesson } from './lesson.js';

export { checkMorph, elementsOf, routeFor, illegalMorphError } from './morph.js';
export type { MorphCheck } from './morph.js';

export { createF } from './formula.js';
export type {
  SpanSpec,
  FormulaSpan,
  FormulaFragment,
  Formula,
  FormulaBuilder,
} from './formula.js';

export type {
  // verdicts / experiments
  Polarity,
  Verdict,
  Outcome,
  Agreement,
  Experiment,
  // verb options
  Mention,
  EnterFrom,
  Emphasis,
  Intensity,
  BuildUpOrder,
  CompareLayout,
  ShowOpts,
  FocusOpts,
  MorphOpts,
  VaryOpts,
  ExposeOpts,
  DemonstrateOpts,
  CascadeOpts,
  BuildUpOpts,
  CompareOpts,
  // structural protocols
  Live,
  NumericHandle,
  VarySettable,
  Interaction,
  MorphSubject,
  BuildUpSubject,
  // morph routes
  MorphHop,
  MorphRoute,
  // step payloads (the renderer contract)
  BeatPayload,
  SayPayload,
  ShowPayload,
  HidePayload,
  RetirePayload,
  ReplacePayload,
  EnableInteractionPayload,
  FocusPayload,
  MorphPayload,
  LinkPayload,
  VaryPayload,
  ExposePayload,
  RevealPayload,
  DemonstrateEventPayload,
  CompareExperimentPayload,
  // formula morphing
  TransformFormulaOpts,
  TransformFormulaPayload,
  FormulaMorphPair,
} from './types.js';
