# visual — the direction and the roadmap

**Status: the live direction + near-term plan, rewritten 2026-07-24.** It replaces
the earlier single-goal version (git has it), which deliberately refused to
sequence a plan. We now have one, because a probe settled the shape (below).
`architecture.md` survives beside this file: it is the **decided engine**; this
file is the **intent and the near-term build**. Where the two disagree, this file
is the intent and `architecture.md` the present — except on the one point below,
where `architecture.md` describes a tier that was decided but never built, and
*this* file is the accurate present.

## The goal (unchanged)

> **Give the LLM the ability to author beautiful artifacts that explain the
> essence behind a mathematical theorem.**

Beautiful and essence, concretely, so they are not a mood:

- **The figure is the artifact, not decoration beside prose.** A person looks at
  the picture first and reads second.
- **It fills its space and composes.** One clear focal figure, supporting pieces
  sized and placed in relation to it, changing as the explanation moves — not a
  scrolling column of equal grey boxes.
- **It has craft.** Axes with real tick marks and honest numbers; labelled
  arrows, braces, callouts; an emphasis hierarchy. The vocabulary a good
  hand-drawn math figure has.
- **Essence, not illustration.** The picture carries the *why* — the thing that
  moves when you drag, the quantity that is invariant, the two routes that turn
  out equal.

## The reframe: this is finishing a decision already made

The instinct "give the model a Manim-class open ceiling — any 2D/3D visual"
sounds like a new ontology. It is not. `architecture.md` already committed to it,
twice, and locked it as un-retrofittable:

- **Decision #4 — vocabulary altitude: two-tier, semantic core, _open geometry
  bottom_.**
- **Locked #6 — a geometry escape hatch reachable from every altitude.** "The 'no
  ceiling' promise is only real if the model can always drop a tier. Layers
  without a downward escape get sealed — and then the human is the bottleneck
  again, one abstraction level up."
- **The moat** — "almost no ceiling… every new visual idea is something it can
  *say*, not something a human must first hand-add to a vocabulary."

The honest present is that **the bottom tier was deferred and never built.** The
renderer tier shipped as a *closed* registry of ~22 `View.*` constructors, each a
hand-written renderer; a visual nobody hand-wrote is unsayable; there is no
geometry escape hatch; figures are a fixed 320×220 (`packages/render/src/views/frame.ts`,
`FRAME_W/FRAME_H`) with no tick, nice-number, band, or annotation logic. So the
work ahead is not a pivot. **It is building the `point · path · text · glyph ·
frame` kernel the moat has promised since 2026-07-21, plus the frame craft that
makes it beautiful.** WebGL/3D is already Phase-3 deferred in `architecture.md`;
we enter it when a lesson forces it, not before.

## The baseline we measure against

`htmls_claude/` holds hand-authored interactive-SVG artifacts (Claude.ai output)
that are the bar to clear — `topology/tychonoff/` (four scenes) and
`topology/persistent-homology/`. Strip the math and they share one recipe:

1. **An open geometry escape hatch** — every figure is bespoke SVG fit to its one
   idea (geometric recession, Cantor triadic maps, binary-digit grids, eased
   assembly). Exactly the tier qed skipped.
2. **Real art direction** — one palette, *semantic* colour roles (free/amber,
   constraint/blue, escape/green, reject/red), and colour that inverts naive
   expectation on purpose (free coordinates drawn loudest: freedom is the
   content).
3. **Frame craft** — honest number lines, ticks, a receding "⋯ forever" that is a
   control not an ellipsis, values to nine decimals.
4. **Interaction that _is_ the proof** — clamp coordinates → the count animates to
   ∞; select rows → an adversary constructs a counterexample to order.

What they *fake by hand* is the half qed already owns: reactivity (`Live<T>`),
claims that break under a drag, correspondence, provenance-as-choreography. That
half is strong and is protected — the gap is entirely in composition and drawing.

## The shape of the fix

A reactive web stage — aesthetic reference **Manim**, architecture reference
**MathBox** (a reactive scene graph), *not* Manim's video pipeline (dead output;
qed's crown jewel is a claim that breaks under a drag, which needs interactivity).

Four calls, decided:

1. **Interactive web, not rendered video.** Keep the reactive graph.
2. **WebGL floor + SVG/KaTeX lid.** SVG/DOM for crisp 2D + labels (all near-term
   work); Three.js/WebGL for the 3D/heavy ceiling (entered when a lesson needs
   it — the already-deferred Phase 3).
3. **Composition is a constraint solver, not flexbox.** "Fills its space and
   composes" is a layout problem; the mature answer is Penrose-style layout from
   declared roles/relations — the model says *intent*, a solver allocates space.
   Deferred until a multi-panel lesson forces it.
4. **Reactivity/claims/correspondence are retained wholesale.** Substrate-
   independent; `packages/library/src/live.ts` (`live()`, `LiveValue<T>`) already
   is the signal cell.

The authoring model is what the moat always said: an **open primitive kernel**
(the escape hatch, always present) plus a **growing library of idioms** the model
reaches for first, dropping to the kernel when none fits; a good kernel figure
gets promoted to an idiom. The registry stops being closed.

Libraries, host-side (the model never writes them; they power the kernel):
**MathBox** and **Three.js** (the WebGL substrate to study/probe), **Penrose**
(layout-from-intent), **d3-scale / d3-shape** (nice-number ticks, path/area
generation — the frame-craft `frame.ts` lacks), **KaTeX** (kept).

## Evidence — probe 1, the coordinate rack

`htmls_claude/topology/persistent-homology/tychonoff-rack-probe.html` (+
`.FINDINGS.md`) re-creates Tychonoff scene I on a from-scratch signals + named-
frame + mark-kernel stage. It passed: matched the baseline's look; the count→∞
and membership verdict are `derived`/`claim` signals with exactly one repaint
`effect` (handlers only *set* signals); not one pixel constant leaked into the
figure body (the author writes in a `recede` frame); and it added a continuous
scrubber the baseline couldn't afford. Friction ledger predicts the first three
idioms (`rackColumn`, `pointMarker`, a vertical `frame.band`).

What the probe did **not** prove, and what the roadmap exists to close: it ran in
a browser with DOM, `Math.random`, `setInterval`, direct SVG — all of which qed
forbids. The open question is whether the kernel survives qed's real environment:
the QuickJS authoring pass (program builds a timeline, never renders), the static
lint (`packages/host/src/lint.ts`), the stepped player, and the free screenshot
tier.

## The roadmap — one thin vertical slice, then extract

Close that gap with the smallest thing that lands a new capability through the
*real* pipeline and is provable free. New session, fresh branch off `main` (the
repo is currently on `import-math-ai-base`). In order:

- **(a) Break the frame open** — `packages/render/src/views/frame.ts`. Make
  `createFrame` responsive (drop fixed 320×220 → fit the panel) and add
  nice-number **ticks** and a vertical **band** axis (start hand-rolled; reach
  for `d3-scale` `ticks`/`nice` only if fiddly). Improves *every* continuous view
  at once (plot, region, riemann, field), so it pays before the hatch exists.
- **(b) Add the escape hatch** — `View.diagram(frame, draw)`: a renderer in
  `packages/render/src/views/diagram.ts`, registered in
  `packages/render/src/registry.ts`, with a constructor in the View builder
  (`packages/library` / `packages/lesson`). `draw` emits marks in *frame
  coordinates* and reads `LiveValue`s; the host re-runs it on repaint, exactly as
  the probe's figure closure reads signals. **This is the load-bearing unknown:**
  does a captured draw closure coexist with the "program never renders" rule and
  pass lint? Discover it here, on purpose.
- **(c) Prove it with one hand-authored qed rack lesson** — in-sandbox TS, no
  browser tricks, using `View.diagram` for the figure and the existing
  `M.derived` / `M.claim` for count→∞ and membership. Run `./run.sh verify --shots`
  and `remount`. Free, and it is the proof.
- **(d) Extract idioms from the friction** — `rackColumn`, `pointMarker`,
  `frame.band` — only where authoring the rack made us want them. The idiom
  library forming above the kernel.
- **(e) Only then teach the model** — update `packages/planner/src/api-reference.ts`
  and `./run.sh record "…"` the rack, so a demonstration exists. qed's law: a
  capability nobody demonstrates does not exist; that one billed record buys a
  cassette *and* the few-shot example.

Do **not** build ahead of this: the 3D/WebGL ceiling (probe 2), Penrose
composition, and LLM authorability all wait until the rack slice forces them.

## Principles we will not give up

- **The LLM authors without pixels — but *with* coordinates in a named frame.**
  The old dogma was "no coordinates ever"; the probe shows the right line is *no
  pixels*: the model says math-space coordinates in a declared frame
  (`frame.colX(k)`, a value on a band), the frame owns the pixel mapping, ticks,
  and fit. That is what keeps ~120-line lessons free of hard-coded geometry while
  giving the open ceiling.
- **No premature ontology.** Probe with a real lesson, keep a friction ledger,
  extract only what friction forces. No space model, chart grammar, or constraint
  solver ahead of a concrete lesson that proves we need it.
- **A capability nobody demonstrates does not exist.** The model imitates the
  worked example far more than the reference prose. Every visual capability is
  real only once a corpus example uses it — visual work and corpus work are the
  same work (step (e)).
- **Keep the free test tier.** Composition and craft are judged on screen
  (`./run.sh verify --shots`, `remount` — both free). Do not push work into billed
  runs a screenshot can settle.
- **Beauty is per-lesson, not one global skin.** A print-grade figure, a cinematic
  homotopy, and a draggable instrument are all correct — for different questions.

## How we will know it is working

Not by an assertion in a test. By looking: regenerate or re-render a lesson, take
the shots, and ask whether a mathematician would call the figure clear and the
theorem's essence visible — against the `htmls_claude/` bar. The near-term gate is
narrower and mechanical: the rack lesson (c) authored in-sandbox, surviving the
lint, executing in QuickJS, and drawing correctly under `./run.sh verify`. That is
the proof the escape hatch is real inside qed, not just in a browser.
