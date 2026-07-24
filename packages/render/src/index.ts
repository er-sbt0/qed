/**
 * @math-ai/render — milestone 3: the DOM/SVG renderer over `@math-ai/core` +
 * `@math-ai/lesson`. Framework-free; theme-aware via CSS custom properties.
 *
 * Shape: a `Stage` (registry + canvas + narration + resonance) hosts `View`s
 * that project semantic objects and implement the lesson's structural
 * protocols (`elements` for morph, `buildUpGroups`); a `Player` walks the
 * timeline and executes step payloads as animation. Views subscribe to
 * slots/collections at authoring time and queue delta animations keyed by the
 * mutation's timeline step — playback runs them when it reaches that step.
 */

export { Stage, createStage } from './stage.js';
export type { StageOpts } from './stage.js';
export { NodeRegistry } from './registry.js';
export type { NodeKey } from './registry.js';
export { View } from './view.js';
export type { PendingAnimation, BackendCapabilities } from './view.js';
export { Player, createPlayer } from './player.js';
export type { PlayerOpts, PlayerStatus, SegmentEvent } from './player.js';
export { splitIntoSegments, segmentTitles, isBeatMarker } from './segments.js';
export type { Segment } from './segments.js';
export { sceneManifest, sceneIndex, transitionFeed } from './manifest.js';
export type {
  SceneManifest,
  ManifestBeat,
  ManifestObject,
  ManifestClaim,
  ManifestView,
  ManifestEvidence,
  ManifestMove,
  ClaimFlip,
  TransitionFeed,
} from './manifest.js';

export { TokensView } from './views/tokens.js';
export type { TokensLayout, TokensOpts } from './views/tokens.js';
export { PartitionView } from './views/partition.js';
export type { PartitionSpec } from './views/partition.js';
export { StateGraphView } from './views/stateGraph.js';
export type { StateGraphSpec, GraphEdgeLike } from './views/stateGraph.js';
export { TableView } from './views/table.js';
export type { TableSpec, CellContent } from './views/table.js';
export { MatrixView } from './views/matrix.js';
export type { MatrixSpec } from './views/matrix.js';
export { BarsView } from './views/bars.js';
export type { BarsSpec } from './views/bars.js';
export { HistoryView } from './views/history.js';
export type { HistorySpec } from './views/history.js';
export { FormulaView } from './views/formulaView.js';
export { FramedView, createFrame, rangeOf, polyline, svgLayer, SVG_NS } from './views/frame.js';
export type { CoordFrame, FrameOpts } from './views/frame.js';
export { PlotView } from './views/plot.js';
export type { PlotSpec } from './views/plot.js';
export { RegionView } from './views/region.js';
export type { RegionSpec, UnderCurveSpec, PolygonSpec, PolygonVertex } from './views/region.js';
export { StripView } from './views/strip.js';
export type { StripSpec } from './views/strip.js';
export { RiemannView } from './views/riemann.js';
export type { RiemannSpec, RiemannRect } from './views/riemann.js';
export { PlaneView } from './views/plane.js';
export type { PlaneSpec } from './views/plane.js';
export { VectorsView } from './views/vectors.js';
export type { VectorsSpec, VectorRef } from './views/vectors.js';
export { FieldView } from './views/field.js';
export type { FieldSpec, FieldSample } from './views/field.js';
export { DiagramView } from './views/diagram.js';
export type {
  DiagramSpec,
  DiagramFrameSpec,
  DiagramPen,
  DiagramMark,
  MarkRole,
  MarkOpts,
  PointOpts,
  PathOpts,
  TextOpts,
  GlyphOpts,
  GlyphKind,
  MathBand,
  BandOpts,
  BandMarkOpts,
  MarkerOpts,
  MarkerState,
} from './views/diagram.js';
export { HeatmapView } from './views/heatmap.js';
export type { HeatmapSpec, HeatmapCell } from './views/heatmap.js';
export { LoopView, edgePath } from './views/loop.js';
export type { LoopSpec, LoopSegmentRef } from './views/loop.js';
export { TilingView } from './views/tiling.js';
export type { TilingSpec, TilingCellRef, TilingEdgeRef } from './views/tiling.js';
export { ReadoutView } from './views/readout.js';
export type { ReadoutSpec } from './views/readout.js';
export { ClaimView, relationGlyph } from './views/claim.js';
export type { ClaimSpec, ClaimSubject } from './views/claim.js';
export { ExperimentView } from './views/experiment.js';
export { LayoutContainerView } from './views/layout.js';
export type { LayoutKindName } from './views/layout.js';
export { appendNarration } from './views/narration.js';

export { interpretEvent } from './events.js';
export type { AnimationCue, HandleRef } from './events.js';
export { stepSupersedesLoop } from './supersede.js';
export { cascadeDurations, paceMs, parseOver, PACE_MS } from './pacing.js';
export { layoutGraph, edgeGeometry, selfLoopGeometry } from './layout/graph.js';
export type { Point, EdgeGeometry, GraphLayoutOpts } from './layout/graph.js';
export { labelOf, displayLabel, fmt } from './util.js';
export { renderTex, plainTex, isTexish } from './tex.js';
export { THEME_CSS, ensureTheme } from './theme.js';
