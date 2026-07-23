/**
 * @math-ai/library — the discipline libraries (automata + probability) in
 * USERLAND over core + lesson + render, plus the program-scope binding that
 * runs a lesson program unmodified.
 *
 * The parity gate lives in verify/: it bundles the acceptance fixture
 * (src/__fixtures__/nerode/beats.ts) against the runtime scope and plays it in
 * a browser. That fixture is engine-owned and frozen — see
 * src/__fixtures__/README.md for why it is a copy rather than a reference into
 * examples/, which is recorded model output and changes whenever we re-record.
 */

export { createProgramScope, getActiveScope, setActiveScope } from './scope.js';
export type { MLib, ProgramScope } from './scope.js';

export { createAutomata } from './automata.js';
export type {
  Alphabet,
  Word,
  Language,
  EquivClass,
  Partition,
  MachineState,
  MachineEdge,
  MachineDiagnostic,
  StateMachine,
  StateMachineOpts,
  AutomataLib,
} from './automata.js';

export { createGraphLib } from './graph.js';
export type {
  GraphNode,
  GraphEdge,
  EdgeSpec,
  Graph,
  Labeled,
  GraphWalk,
  Traversal,
  SpanningTree,
  LiveSpanningTree,
  MapDiagnostic,
  StructureMap,
  GraphLib,
} from './graph.js';

export { byLabel, findOr, reportDiagnostics } from './structure.js';

export { createProbability, powerIterate } from './probability.js';
export type {
  ChainState,
  StateSet,
  MatrixCell,
  MatrixPolicy,
  StochasticMatrix,
  Transition,
  Distribution,
  MarkovChain,
  Walk,
  ProbLib,
} from './probability.js';

export { createInteraction } from './interaction.js';
export type { InteractionLib } from './interaction.js';

export { createViews } from './views.js';
export type { ViewLib, LayoutLib, CellContent } from './views.js';

export { createParameter } from './parameter.js';
export type { Parameter } from './parameter.js';

export { createFieldLib } from './field.js';
export type { FieldLib, VectorField, ScalarField, Vec2 } from './field.js';

export { createClaim } from './claim.js';
export type { Claim, ClaimOpts, ClaimSides, ClaimPredicate, ClaimRelation, ClaimEvidence } from './claim.js';

export { derivedNumber, constNumber, numOf } from './numeric.js';
export type { LabeledNumber } from './numeric.js';

export { live, constLive, isLive, valueOf, vec2Equals, listEquals, vec2ListEquals } from './live.js';
export type { Live, LiveValue, LiveOpts } from './live.js';

export { createCalculus, integrate } from './calculus.js';
export type { CalcLib, Fn, Accumulation, Increment, Rectangle, RiemannSum } from './calculus.js';

export { createLinearAlgebra, signedArea, eigen2x2 } from './linalg.js';
export type {
  LinAlgLib,
  Vector2,
  Matrix2,
  Polygon,
  Eigen,
  LinearMap,
} from './linalg.js';
