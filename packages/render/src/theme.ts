/**
 * theme.ts — the stylesheet the stage injects once per document. Theme-aware
 * via CSS custom properties: light defaults on `.mr-stage`, dark overrides
 * under an explicit `[data-theme="dark"]`. Every view styles itself exclusively
 * through `--mr-*` variables.
 */

export const THEME_STYLE_ID = 'math-ai-render-theme';

const vars = (dark: boolean): string =>
  dark
    ? `
  --mr-bg: #161d2e;
  --mr-panel: #1c2438;
  --mr-ink: #e6ebf5;
  --mr-muted: #97a1b8;
  --mr-line: #263148;
  --mr-accent: #2dd4bf;
  --mr-accent-soft: rgba(45, 212, 191, 0.18);
  --mr-accept: #4ade80;
  --mr-accept-soft: rgba(74, 222, 128, 0.16);
  --mr-reject: #f87171;
  --mr-reject-soft: rgba(248, 113, 113, 0.16);
  --mr-neutral: #97a1b8;
  --mr-neutral-soft: rgba(151, 161, 184, 0.16);
  --mr-still: #c9a86a;
  --mr-token-bg: #262c37;
  --mr-shadow: rgba(0, 0, 0, 0.5);
`
    : `
  --mr-bg: #ffffff;
  --mr-panel: #f0f2f8;
  --mr-ink: #1a2233;
  --mr-muted: #5b6577;
  --mr-line: #e2e6ef;
  --mr-accent: #0d9488;
  --mr-accent-soft: rgba(13, 148, 136, 0.14);
  --mr-accept: #15803d;
  --mr-accept-soft: rgba(21, 128, 61, 0.13);
  --mr-reject: #b91c1c;
  --mr-reject-soft: rgba(185, 28, 28, 0.12);
  --mr-neutral: #5b6577;
  --mr-neutral-soft: rgba(91, 101, 119, 0.12);
  --mr-still: #a16207;
  --mr-token-bg: #e6eaf3;
  --mr-shadow: rgba(30, 40, 60, 0.18);
`;

export const THEME_CSS = `
:root, .mr-stage { ${vars(false)} }
[data-theme="dark"], [data-theme="dark"] .mr-stage { ${vars(true)} }
[data-theme="light"], [data-theme="light"] .mr-stage { ${vars(false)} }

.mr-stage {
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: var(--mr-ink);
  background: var(--mr-bg);
  border: 1px solid var(--mr-line);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: stretch;
  position: relative;
}
.mr-canvas {
  /* The figure is the artifact: it claims the row first. A generous basis
     (bigger than the narration's) means that on anything narrower than
     roughly basis+basis+gap the pair wraps — narration drops BELOW the
     figure, rather than always sitting in a fixed side column that caps how
     wide a figure is allowed to grow. On a wide stage there is still room for
     both side by side, unchanged from before. */
  flex: 3 1 480px;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: flex-start;
  align-content: flex-start;
  min-height: 200px;
  position: relative;
  /* A flex item defaults to min-width:auto, which refuses to shrink below the
     intrinsic width of its content. The narration beside it bottoms out at
     min-width:260px and cannot give way past that either, so a wide canvas
     (markov's matrix, at a narrow viewport) pushed the pair past the stage
     and shoved the narration out of the visible box entirely — measured at
     over 100px past the edge on a ~900px viewport. Letting the canvas shrink
     keeps the narration on screen; it wraps, and anything genuinely
     unshrinkable inside it still gets the stage's horizontal scroll.
     NB: this whole block is inside a template literal — no backticks. */
  min-width: 0;
}
.mr-narration {
  flex: 1 1 280px;
  min-width: 220px;
  background: none;
  border: 0;
  border-left: 1px solid var(--mr-line);
  border-radius: 0;
  padding: 4px 0 4px 18px;
  font-size: 13.5px;
  line-height: 1.5;
  max-height: 460px;
  overflow-y: auto;
}
.mr-narration p { margin: 0 0 10px; color: var(--mr-muted); transition: color 0.3s; }
.mr-narration p.mr-current { color: var(--mr-ink); }
.mr-mention {
  color: var(--mr-accent);
  border-bottom: 1px dotted var(--mr-accent);
  cursor: pointer;
  font-family: ui-monospace, monospace;
  font-size: 0.92em;
}

.mr-view { transition: opacity 0.35s ease, transform 0.35s ease; }
.mr-hidden { opacity: 0 !important; visibility: hidden; }
.mr-measuring { visibility: hidden; }
.mr-prehidden { opacity: 0; visibility: hidden; }
.mr-panelbox {
  background: var(--mr-panel);
  border: 1px solid var(--mr-line);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 1px 3px var(--mr-shadow);
}
.mr-view-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mr-muted);
  margin: 0 0 8px;
}

/* tokens */
.mr-tokens-row { display: flex; gap: 6px; flex-wrap: wrap; }
.mr-tokens-column { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.mr-tokens-scatter { position: relative; width: 270px; height: 150px; }
.mr-tokens-scatter .mr-token { position: absolute; }
.mr-token {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--mr-token-bg);
  border: 1px solid var(--mr-line);
  font-family: ui-monospace, monospace;
  font-size: 12.5px;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

/* partition buckets */
.mr-buckets { display: flex; gap: 14px; }
.mr-bucket {
  border: 1.5px solid var(--mr-line);
  border-radius: 12px;
  min-width: 120px;
  min-height: 96px;
  padding: 8px;
  background: var(--mr-panel);
}
.mr-bucket-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--mr-muted);
  margin-bottom: 6px;
  text-align: center;
}
.mr-bucket-members { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; }

/* table */
.mr-table { border-collapse: collapse; font-size: 13px; }
.mr-table th, .mr-table td {
  border: 1px solid var(--mr-line);
  padding: 4px 10px;
  text-align: center;
}
.mr-table th { background: var(--mr-token-bg); font-family: ui-monospace, monospace; font-weight: 600; }

/* verdicts */
.mr-verdict {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.mr-verdict-accept { color: var(--mr-accept); background: var(--mr-accept-soft); }
.mr-verdict-reject { color: var(--mr-reject); background: var(--mr-reject-soft); }
.mr-verdict-neutral { color: var(--mr-neutral); background: var(--mr-neutral-soft); }

/* matrix */
.mr-matrix { border-collapse: collapse; font-size: 13px; font-family: ui-monospace, monospace; }
.mr-matrix th, .mr-matrix td { border: 1px solid var(--mr-line); padding: 4px 10px; text-align: right; }
.mr-matrix th { background: var(--mr-token-bg); text-align: center; }
.mr-matrix td { min-width: 46px; }
.mr-exposed td { cursor: ns-resize; }
.mr-exposed { outline: 2px dashed var(--mr-accent); outline-offset: 3px; }

/* bars */
.mr-bars { display: flex; gap: 16px; align-items: flex-end; height: 150px; padding-top: 16px; }
.mr-bar-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.mr-bar-value { font-size: 11px; font-family: ui-monospace, monospace; color: var(--mr-muted); }
.mr-bar {
  width: 34px;
  background: var(--mr-accent);
  border-radius: 4px 4px 0 0;
  opacity: 0.85;
  min-height: 2px;
}
.mr-bar-label { font-size: 11.5px; color: var(--mr-ink); }

/* graph + history svg */
.mr-svg text { fill: var(--mr-ink); font-family: ui-sans-serif, system-ui, sans-serif; }
.mr-svg g { transform-box: fill-box; transform-origin: center; }
.mr-node circle { fill: var(--mr-panel); stroke: var(--mr-accent); stroke-width: 1.8; }
.mr-node.mr-accepting circle { stroke-width: 3; }
.mr-node text { font-size: 11px; text-anchor: middle; dominant-baseline: middle; }
.mr-edge path { fill: none; stroke: var(--mr-muted); stroke-width: 1.5; transition: stroke .25s ease, stroke-width .25s ease; }
.mr-edge text { font-size: 10px; fill: var(--mr-muted); text-anchor: middle; transition: fill .25s ease; }
/* live spanning-tree membership (StateGraphView edgeEmphasis, re-read on applyState) */
.mr-edge.mr-intree path { stroke: var(--mr-accent); stroke-width: 3; }
.mr-edge.mr-intree text { fill: var(--mr-accent); font-weight: 600; }
/* an edge serving as a weight-drag rail (StateGraphView.enableRailDrag) */
.mr-edge.mr-edge-rail { cursor: ns-resize; outline: none; }
.mr-edge.mr-edge-rail text { font-weight: 700; text-decoration: underline dashed; }
.mr-history path.mr-series { fill: none; stroke-width: 2; }
.mr-history .mr-axis { stroke: var(--mr-line); stroke-width: 1; }
.mr-history text { font-size: 10px; fill: var(--mr-muted); }

/* continuous views: plot / region / strip / riemann / plane / vectors
   The figure fills the space its panel is given: the SVG's viewBox keeps the
   logical (mapping) dimensions frame.ts computed with, but width/height here
   let it grow with its container — up to a generous cap so a lone figure in
   a wide stage does not blow up to something absurd. 640px is ~2x the widest
   provider's logical width (plot's 320). */
.mr-plotsvg { overflow: hidden; display: block; width: 100%; height: auto; max-width: 640px; }
.mr-plotsvg .mr-axis { stroke: var(--mr-line); stroke-width: 1.2; fill: none; }
.mr-plotsvg .mr-tick { stroke: var(--mr-line); stroke-width: 1; }
.mr-plotsvg .mr-tick-label { font-size: 9.5px; fill: var(--mr-muted); font-family: ui-monospace, monospace; }
.mr-curve { fill: none; stroke: var(--mr-accent); stroke-width: 2.2; stroke-linejoin: round; }
.mr-backdrop { fill: none; stroke: var(--mr-muted); stroke-width: 1.4; opacity: 0.35; }
.mr-plot-label { font-size: 11px; fill: var(--mr-muted); }
.mr-plot-caption { font-size: 12px; color: var(--mr-muted); line-height: 1.4; padding: 0 0 2px 2px; }
.mr-rail { fill: transparent; }
.mr-rail.mr-exposed { fill: var(--mr-accent-soft); cursor: ew-resize; outline: none; }
.mr-marker circle { fill: var(--mr-accent); stroke: var(--mr-panel); stroke-width: 1.5; }
.mr-marker-drop { stroke: var(--mr-accent); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.6; }
.mr-fill { fill: var(--mr-accent); fill-opacity: 0.22; stroke: var(--mr-accent); stroke-width: 1.2; }
.mr-fill.mr-negative { fill: var(--mr-reject); stroke: var(--mr-reject); }
.mr-fill.mr-collapsed { fill-opacity: 0; stroke-width: 2.6; stroke: var(--mr-still); }
.mr-region-edge { stroke: var(--mr-accent); stroke-width: 2; }
.mr-region-label { font-size: 11px; fill: var(--mr-muted); text-anchor: middle; }
.mr-vertex { fill: var(--mr-panel); stroke: var(--mr-accent); stroke-width: 1.5; }
.mr-strip-rect { fill: var(--mr-still); fill-opacity: 0.35; stroke: var(--mr-still); stroke-width: 1.4; }
.mr-strip-rect.mr-negative { fill: var(--mr-reject); stroke: var(--mr-reject); }
.mr-strip-label { font-size: 10px; fill: var(--mr-muted); }
.mr-riemann-rect {
  fill: var(--mr-accent);
  fill-opacity: 0.3;
  stroke: var(--mr-accent);
  stroke-width: 1;
  transition: opacity 0.3s ease;
}
.mr-gridline { fill: none; stroke: var(--mr-line); stroke-width: 1; opacity: 0.75; }
.mr-arrow line { stroke: var(--mr-accent); stroke-width: 2.4; stroke-linecap: round; }
.mr-arrow-label { font-size: 11px; fill: var(--mr-accent); }
.mr-field-arrow {
  fill: none;
  stroke: var(--mr-accent);
  stroke-width: 1.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mr-heatmap-cell { fill: var(--mr-accent); stroke: none; shape-rendering: crispEdges; }
.mr-heatmap-cell.mr-negative { fill: var(--mr-reject); }
.mr-loop-edge {
  fill: none;
  stroke: var(--mr-accent);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mr-tiling-cell {
  fill: var(--mr-accent);
  fill-opacity: 0.14;
  stroke: none;
  transition: opacity 0.3s ease;
}
.mr-tiling-edge { fill: none; stroke-linecap: round; }
/* interior edges cancel in pairs; boundary edges are what survives — the two
   sets are focused against each other, so they must read apart at a glance */
.mr-tiling-edge.mr-interior { stroke: var(--mr-muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.65; }
.mr-tiling-edge.mr-boundary { stroke: var(--mr-accent); stroke-width: 2.2; }
.mr-plot, .mr-region, .mr-strip, .mr-riemann, .mr-plane, .mr-vectors,
.mr-field, .mr-heatmap, .mr-loop, .mr-tiling { line-height: 0; }

/* readout */
.mr-readout { min-width: 132px; font-size: 13px; }
.mr-readout-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.mr-readout-label { color: var(--mr-muted); font-size: 11.5px; }
.mr-readout-value { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.mr-readout-gap { border-top: 1px solid var(--mr-line); margin-top: 4px; padding-top: 4px; }
.mr-readout-gap .mr-readout-value { color: var(--mr-muted); }
.mr-readout-gap .mr-converged { color: var(--mr-accept); font-weight: 700; }

/* claim */
.mr-claim { min-width: 160px; font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
.mr-claim-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.mr-claim-label { font-size: 13px; }
.mr-claim-body { display: flex; align-items: baseline; gap: 8px; }
.mr-claim-side { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.mr-claim-rel { color: var(--mr-muted); }
.mr-claim-gap { margin-left: auto; color: var(--mr-muted); font-size: 11.5px; }
.mr-claim-broken { box-shadow: inset 0 0 0 1px var(--mr-reject); }

/* formula */
.mr-formula { font-size: 18px; padding: 12px 16px; }
.mr-fspan { display: inline-block; border-radius: 4px; padding: 0 1px; transition: background 0.3s, box-shadow 0.3s; }
.mr-fspan.mr-preserved { background: var(--mr-accent-soft); }

/* experiment */
.mr-experiment { display: flex; flex-direction: column; gap: 8px; }
.mr-experiment-row { display: flex; gap: 12px; }
.mr-experiment.mr-stacked .mr-experiment-row { flex-direction: column; }
.mr-outcome {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--mr-line);
  border-radius: 10px;
  padding: 8px 12px;
  background: var(--mr-panel);
}
.mr-outcome-arrow { color: var(--mr-muted); }
.mr-agreement { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-align: center; }
.mr-agreement-distinguished { color: var(--mr-reject); }
.mr-agreement-agree { color: var(--mr-accept); }

/* layout containers */
.mr-columns { display: flex; gap: 18px; align-items: flex-start; }
.mr-stack { display: flex; flex-direction: column; gap: 14px; }
.mr-overlay { position: relative; }
.mr-overlay > .mr-view { position: absolute; inset: 0; }
.mr-overlay > .mr-view:first-child { position: relative; }

/* animation states */
.mr-lit { box-shadow: 0 0 0 3px var(--mr-accent-soft), 0 0 10px var(--mr-accent-soft); background: var(--mr-accent-soft); }
g.mr-lit, .mr-svg .mr-lit { box-shadow: none; filter: drop-shadow(0 0 4px var(--mr-accent)); }
.mr-emph-disagreement { animation: mr-shake 0.5s ease; outline: 2px solid var(--mr-reject); outline-offset: 2px; border-radius: 6px; }
.mr-emph-agreement { outline: 2px solid var(--mr-accept); outline-offset: 2px; border-radius: 6px; }
.mr-emph-stillness { outline: 2px dashed var(--mr-still); outline-offset: 3px; border-radius: 6px; }
.mr-pop { animation: mr-pop 0.4s ease; }
.mr-traveler { position: fixed; z-index: 60; pointer-events: none; margin: 0; }
.mr-dot { border-radius: 50%; background: var(--mr-accent); box-shadow: 0 0 6px var(--mr-accent-soft); }
.mr-dot-ambient { opacity: 0.45; }

@keyframes mr-pop {
  0% { transform: scale(0.4); opacity: 0; }
  70% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); }
}
@keyframes mr-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  50% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
}
`;

/** Inject the theme stylesheet once per document. */
export function ensureTheme(doc: Document): void {
  if (doc.getElementById(THEME_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = THEME_CSS;
  doc.head.appendChild(style);
}
