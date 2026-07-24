# visual — the one goal

**Status: the live direction, written 2026-07-24.** It replaces the three
planning docs that used to sit here (vision, roadmap, direction — all deleted,
git has them). `architecture.md` survives beside this one: it describes the
engine as it *is*, and where it disagrees with this file it is describing the
present and this file the intent.

There is exactly one goal right now, and nothing else is in scope:

> **Give the LLM the ability to author beautiful artifacts that explain the
> essence behind a mathematical theorem.**

We are not sequencing a plan, not choosing a next discipline, not building an
argument layer, not touching the conversational loop. Those may all be real
later. They are not this. The single question every change answers is: *did a
generated lesson get closer to something a person would call beautiful and
would understand the theorem from?*

## What "beautiful" and "essence" mean here

Concretely, so it is not a mood:

- **The figure is the artifact, not decoration beside prose.** Today it is the
  reverse — see below. A person should look at the picture first and read
  second.
- **It fills its space and composes.** One clear focal figure, supporting
  pieces sized and placed in relation to it, changing as the explanation moves.
  Not a scrolling column of equal grey boxes.
- **It has craft.** Axes with real tick marks and honest numbers; labelled
  arrows, braces, callouts; an emphasis hierarchy so the eye knows where to
  look. The vocabulary a good hand-drawn math figure has.
- **Essence, not illustration.** The picture carries the *why* — the thing that
  moves when you drag, the quantity that is invariant, the two routes that turn
  out equal. The engine already has the machinery for this (reactivity,
  correspondence, claims); the visual layer has to make it legible.

## Where we actually are

Verified in the code and on screen, this is the honest starting point:

1. **Layout is `flex-wrap: wrap`.** The stage is a flex row — a canvas of
   equal-gap wrapping boxes plus a narration column. `view.ts` states the rule
   outright: *"Views never position themselves."* Nothing measures, allocates,
   or fits. `Layout.columns/stack` are flex containers; only `overlay` means
   anything real (a shared coordinate frame).
2. **Figures are a fixed 320×220** regardless of viewport, so they sit small and
   clipped in a wide panel. `frame.ts` has no tick, gridline, nice-number, or
   axis-label logic, and there is no annotation layer anywhere.
3. **The visual vocabulary is a closed registry** of ~22 `View.*` constructors,
   each a hand-written renderer. A visual nobody hand-wrote is currently
   unsayable — there is no geometry escape hatch.
4. **Prose dominates the picture** — dense narration beside a small figure, so
   reading is the primary activity. An inversion of the premise above.

The semantics underneath are strong and are not the problem. Identity +
correspondence, `Live<T>` reactivity, provenance-as-choreography, claims that a
drag can break — all of that works and must be protected. The gap is entirely
in how the result is composed and drawn.

## The principles we will not give up

These are constraints on *how* we improve, chosen so the solution stays robust
and flexible rather than a pile of special cases:

- **The LLM stays the author, and it authors without coordinates.** The current
  system writes ~120-line lessons with zero hard-coded geometry. Whatever
  composition engine we build must let the model say *roles and intent*
  (this is focal, this supports it) and allocate space itself. The moment the
  model has to place panels by pixel, we have lost the property that makes this
  work.
- **No premature ontology.** We do not adopt a big abstraction (a space model, a
  chart grammar, a constraint solver) ahead of a concrete lesson that proves we
  need it. Probe with a real example, keep a friction ledger, extract only what
  friction forces. Flexibility comes from resisting the general solution until
  the specific ones demand it.
- **A capability nobody demonstrates does not exist.** The model imitates the
  worked example far more than the reference prose (measured, repeatedly). So
  every visual capability we add is only real once a corpus example uses it —
  adding a renderer or a token without adding a demonstration changes nothing
  the model will reach for. Visual work and corpus work are the same work.
- **Keep the free test tier.** Composition and craft are judged on screen
  (`./run.sh verify --shots`, free). Do not push work into billed runs that a
  screenshot can settle.
- **Beauty is per-lesson, not one global skin.** A print-grade figure, a
  cinematic homotopy, and a draggable instrument are all correct — for
  different questions. Aim for a system that can be told which register a lesson
  wants, not a single aesthetic imposed on all of them.

## How we will know it is working

Not by assertions in a test. By looking: regenerate or re-render a lesson, take
the shots, and ask whether a mathematician would call the figure clear and the
theorem's essence visible. When the answer is reliably yes across several
disciplines, this goal is met and the next one can be chosen.
