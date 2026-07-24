# Reactive Math Canvas — Engine Architecture

> Status: **decided, 2026-07-21 (second pivot); spike-validated 2026-07-21.**
> This supersedes both the declarative-JSON pipeline and the custom-DSL design
> that briefly replaced it. Source material: `docs/new_architecture/`
> (guidelines + four worked examples). The four examples in that directory are
> the **acceptance test** for everything below. Two of them have since been
> hand-authored against types-only API sketches and strict-typechecked
> (`spikes/myhill-nerode/`, `spikes/markov/`); the section *Spike validation*
> records what those programs confirmed and what they changed.

## The moat

The interactive math **engine** and the **explanation pipeline** are the defensible
core. What they optimize for:

> **The LLM can express rich, multi-discipline math illustrations with almost no
> ceiling, and every new visual idea is something it can *say*, not something a
> human must first hand-add to a vocabulary.**

Correctness is deliberately **not** a priority. No CAS, no symbolic kernel, no
proof obligation. Numerics exist to *draw things*, not to certify them.

### Priorities

1. **Expressiveness + richness across many disciplines** — versatility *and*
   depth, no compromise.
2. **The LLM stays the math brain.** Give it a language, types, and a library —
   let it compose.
3. **Verifiability is deprioritized.**
4. **Interactivity is one tool among many.** Explanation quality comes first.
5. **All richness levers in scope**: visual range · narrative↔visual binding ·
   motion/time · aesthetic polish.

---

## The central claim

The unit of authoring is **not** a graphical primitive (circle, arrow, line) and
**not** a validated JSON scene. It is a **semantic object with stable identity**,
projected into one or more **views**, related to other objects by
**correspondences**, driven by **parameters**, and unfolded by **explanatory
verbs** over a timeline.

The thing that makes an explanation land is almost never the drawing. It is the
*correspondence*: matrix cell ↔ graph edge, equivalence class ↔ DFA state,
Riemann rectangle ↔ sum term, `f(x)` ↔ slope of the accumulation. All four
worked examples turn on this. It is the product, not a feature.

---

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | What does the LLM write? | **TypeScript** against a builder API |
| 2 | What executes it? | **QuickJS-wasm**, shipped to the browser, live |
| 3 | What is an artifact? | **The program itself** + seeded determinism |
| 4 | Vocabulary altitude | **Two-tier**: semantic core, open geometry bottom |
| 5 | Time model | **Reactive graph** under a **declarative timeline** |
| 6 | Closures | **Allowed everywhere**, re-invoked live |
| 7 | Verb set | **Small kernel + verbs-as-macros** |
| 8 | Layout | **Semantic templates + graph autolayout** |
| 9 | Formulas | **Structured formula AST**, KaTeX per span |
| 10 | Migration | **Hard cut** below the planner |
| 11 | Orchestration | **Keep the plan pass**, swap the step payload |
| 12 | First build | **Reactive + IR core**, examples as acceptance test |

---

## Locked early (retrofitting these is a rewrite)

**1 — Stable IDs and object handles.** A property of *every* constructor and
every IR node. Subpart addressing from day one: `A.cell(0,1)`,
`region.boundary`, `chain.state("rainy")`, `eq.span("P_{ij}")`,
`plot.pointAt(x)`. Subparts are where every interesting correspondence attaches.
IDs are deterministic when explicitly supplied.

**2 — The correspondence graph.** A generic first-class edge with a relation
kind — `represents` · `came-from` · `contributes-to` · `counterpart-of` ·
`maps-to`. Explicitly **not** an assertion of mathematical equality. Powers
synchronized highlighting, semantic morphs, label anchoring, and formula↔visual
binding. *Spike upgrade:* most edges are **recorded by construction**
(provenance), not authored — see *Spike validation*; authored `link` is the
minority case.

**3 — Formulas are never opaque strings.** A formula is an addressable tree of
named spans. The morphing engine (`transformFormula`) is deferred; the
*authoring contract* is not, because retrofitting it means re-authoring every
formula ever written.

**4 — Views are projections, never the source of truth.** One object, N
simultaneous views, zero of them authoritative. Views register against object
types and are replaceable. *Linked multi-views* are not a separate mechanism —
they are the emergent consequence of reactive graph + handles + correspondence.

**5 — Introspection and diagnostics are part of the LLM API.**
`scene.describe()`, `object.capabilities()`, `view.anchors()`,
`timeline.describe()`. Capability errors return **alternatives**. With an open
two-tier vocabulary the LLM *will* reach for things that don't exist; the
discover-and-repair loop is what makes an open vocabulary survivable.

**6 — A geometry escape hatch reachable from every altitude.** The "no ceiling"
promise is only real if the model can always drop a tier. Layers without a
downward escape get sealed — and then the human is the bottleneck again, one
abstraction level up.

---

## The stack

```
  AnswerPlan  (kept: topic, mode, steps[], reserved style)
        │
        ▼
  lesson program  ── TypeScript, authored by the LLM
        │
        ▼  executes in QuickJS-wasm, live, interruptible
        │
  ┌─────┴──────────────────────────────────────────┐
  │  Runtime IR (internal, holds closure refs)     │
  │    · semantic objects + stable IDs             │
  │    · reactive graph: parameters → derived      │
  │    · correspondence edges                      │
  │    · timeline: sequence/parallel/morph/vary    │
  │    · view registrations                        │
  └─────┬──────────────────────────────────────────┘
        ▼
  layout (semantic templates + graph autolayout)
        ▼
  renderers (SVG/Canvas 2D · 3D · KaTeX spans)
```

### The IR demoted, not deleted

Round-one framing had the IR as the wire format — "what ships and replays." Live
closures make that impossible: a closure cannot be serialized. So **the program
is the artifact**; the IR is the runtime's *internal* structure, holding closure
references. Reproducibility comes from determinism plus seeded randomness, not
from a data snapshot. `scene.describe()` becomes a runtime query against a live
world, which is strictly better for LLM repair than inspecting static data.

### Two-tier vocabulary

```
  geometry / kernel      point · path · text · plot · region · glyph · frame
        ▲                          (small, fixed, always reachable)
  semantic libraries     markovChain · language · accumulation · linearMap
        │                  partition · stateGraph · distributionBars
        │                  ← written IN the same TS API, not in engine code
        ▲
  the LLM's program      reaches for a library when it exists,
                         composes from the kernel when it doesn't
```

> **Status note (2026-07-24): the bottom tier was never built.** The renderer
> tier shipped as a *closed* registry of ~22 `View.*` constructors; the
> `point · path · text · glyph · frame` geometry kernel — and with it the
> escape hatch of locked-item #6 — does not exist yet, and figures are a fixed
> 320×220 with no tick/nice-number/band logic. Finishing this tier is the active
> visual work; `docs/visual.md` carries the plan (the `View.diagram` escape hatch
> + a real frame layer, proven by a hand-authored lesson through QuickJS). This
> is the one place below where the decided design describes something the present
> engine lacks.

The failure mode this avoids: if the LLM's only nouns are `Math.markovChain` and
`View.stateGraph`, a discipline nobody anticipated is *unsayable* — the
Myhill–Nerode bug, one level up. A composition that works becomes the library
next time.

### Verb kernel

Irreducible, implemented by the runtime. **Now empirical, not aspirational** —
this is the exact set two hand-authored disciplines needed (see *Spike
validation*):

```
say · show · hide · retire · replace · focus · morph · link · vary · expose
cascade · parallel · buildUp · demonstrate · compareExperiment
transformFormula · enableInteraction
```

`retire`/`replace` are the newest, and they are the only two a *linear* lesson
never needed. `hide` means "look away this beat" — the object stays live, and a
lesson that never asks what still exists cannot tell the difference. A
conversation asks on every turn (its scene manifest is built from what is still
live), so "temporarily not shown" and "no longer part of this" had to stop
being the same step. `replace` also mints the `counterpart-of` edge itself,
because forgetting it is silent and makes a later `morph` between the two
illegal.

plus constructors `slot` / `range` / `parameter` and
`Layout.{columns, stack, overlay}`. The last two verbs and `parameter` are
milestone 6's additions, forced by the third and fourth spikes (see *Spike
validation — continuous disciplines*); the determinant spike added nothing at
all.
Changes from the round-one kernel: `sequence` became implicit call order;
`transform` folded into `vary`/`morph`; `demonstrate`, `compareExperiment`,
and `expose` earned kernel slots because macros cannot express them (they need
derivation traces, lockstep execution of one closure, and input binding,
respectively).

Everything else in the prototypes' ~50-verb vocabulary is a **macro** written in
the same API:

```
merge(a, b)  =  parallel(morph(a→m), morph(b→m),
                         link(a, m, "came-from"))

reinterpret(partition, "state-machine")
             =  per class: morph(bucket → node)
                         + link(class, node, "counterpart-of")
                         + edges from the continuation operation
```

So `collapse`, `reinterpret`, `iterate`, `accumulate`, `probe`, `freezeAt` are
library code, not engine code — consistent with decision #4.

### Time model

Parameters and derived values form a **reactive dependency graph**. Above it
sits a **declarative timeline** of semantic verbs that *can* add, remove, and
re-map objects — purity where it pays, staged mutation where it's needed.

This is a deliberate reversal of the previous design's build-once/react-leaves
staging, which froze structural counts at build time. That model cannot express
`merge(["0","00"])`, `reinterpret(partition → state machine)`, or
`iterate(chain, {steps: 15})` — all of which are load-bearing in the examples.

The reactive cell is `Live<T>` for arbitrary `T` — points, geometry, booleans,
verdicts — and `NumericHandle` is now literally `Live<number>`. It was
scalar-only for a long time, and everything live that was not a number got
faked around that: a claim's verdict as a getter, a segment's endpoints as
plain closures re-run per read. `world.derived<T>` in core was **already
generic**, so the constraint lived entirely in the protocol type and the
library's one wrapper (`packages/library/src/live.ts`). The load-bearing part
of the generalization is **equality**: a derived over a structural value
allocates a fresh value every run, so without an `equals` no dependent can ever
short-circuit.

The spikes settled its concrete shape (the **value model**): derived values are
**immutable and provenance-carrying**; `Slot<T>` reactive cells are the only
timeline-mutable state; `Collection`s are reactive sources whose derived
structures animate deltas. Iteration is `slot.set(chain.step(slot.value))`
under `cascade`; a history plot is a free fold over a slot's timeline; the
"infinitely many strings" stream is just `words.add(w)` re-bucketing a derived
partition — no bespoke verbs anywhere.

---

## Spike validation — what hand-authoring changed (2026-07-21)

Two beats programs were authored by hand against types-only API sketches and
strict-typechecked: `spikes/myhill-nerode/` (distinguishing experiment →
collapse → reinterpretation) and `spikes/markov/` (particle → flow →
convergence → stationarity → touch-it). Each directory holds the API sketch
(`api.ts`), the authored program (`beats.ts`), and `FINDINGS.md`. Both
disciplines authored cleanly (~120–130 lines, ~10 verbs, zero coordinates)
with a kernel that stayed stable across them. The two `beats.ts` files are
now the **executable acceptance layer**: the core is done when both run in a
browser.

What they force on the design above:

**Provenance is the missing half of the correspondence graph.** Nearly every
correspondence edge in both programs was recorded *by construction*:
`append` records `came-from`; `stateMachine({statesFrom})` records
class↔state `counterpart-of`; `chain.step(d)` records per-parcel
`came-from`/`contributes-to`; `sampleWalk` records its seed and path. Three
mechanisms fall out of this one design:

- **`demonstrate(handle)`** — replay a derived value's derivation as
  choreography. "The DFA edges draw themselves" and the split/travel/merge
  flow of matrix multiplication are both this verb; no flow machinery exists.
- **Morph legality** — `morph(A, B)` is legal iff every element of A reaches
  an element of B through the correspondence graph; the animation routes
  along those edges. (This is what makes the bucket→state-node morph
  well-defined across two *different* objects.)
- **Emergent linking** — matrix-cell↔graph-edge hover sync and
  formula-term↔flow timing are *not authored*: views projecting the same
  objects, and formula spans linked to objects, light up whenever those
  objects animate. The source examples' hand-written `link({matrixCell,
  graphEdge})` disappeared entirely.

Cost control: a provenance record is just `(operation, inputs)` — values are
immutable and deterministic, so the full trace is **re-derived lazily** when a
`demonstrate` or `set({via: "derivation"})` actually needs it. Cheap on the
drag path, rich on demand.

**Narration is a view.** `lesson.say` is a tagged template; interpolated
handles become live, linked mentions in the rendered text. This closes the
narrative↔visual binding lever with no new mechanism (and settles the old
`{{ expr }}` question — host-language templates win because they typecheck).

**Formula contract refinements.** Spans are named by semantic *role*, and one
role covers every fragment it recurs in (`π` twice in `πP=π`; `z` three times
in the Nerode definition). `F.tex` must read `strings.raw` — in a cooked
template `\sim` silently becomes `sim`, so the tag is load-bearing.

**Interaction policy lives on semantic objects.**
`stochasticMatrix({editable: "renormalize-row"})`: invariant-preserving edits
make invalid states unreachable at the object boundary, so downstream
reactive numerics never see garbage. Same pattern yields free coherence
diagnostics: `checkWellDefined: "sampled"` spot-checks what a construction
presupposes (for a Nerode partition, that well-definedness *is* the theorem's
hypothesis) and reports — never crashes, never a CAS.

**Verdicts are typed** — `{label, polarity: accept|reject|neutral}`. Emphasis
and color bind to polarity; renderers never parse strings.

**The library claim passed twice in userland.** `probeContinuations`,
`iterate`, and even the total-variation metric `tv` were authored inside the
beats programs as plain functions over kernel verbs — including LLM-style
self-serve numerics instead of requesting engine functions.

**Two authoring laws for the generation prompt:** headers and subjects are
**handles, never strings**; **macros return the handles they mint** (or
callers can't link to them).

Still unexercised by the first two spikes — and therefore what the remaining
two worked examples had to pressure-test: continuous plots/regions/
accumulation, linear-map grids, formula *morphing*, layout beyond columns, 3D.
The next section reports what happened when they did.

---

## Spike validation — continuous disciplines (2026-07-22)

`spikes/ftc/` and `spikes/determinant/` were authored the same way, then
**executed**: both now run byte-for-byte unmodified through QuickJS in a
browser. **The kernel held a third and fourth time.** FTC forced exactly two
additions and the determinant forced none.

**`M.parameter(name, value, {range})` — the interaction-mutable scalar.**
`Slot` is the *timeline*-mutable cell; the continuous story hangs on a
*user*-mutable scalar with a range (the dragged x, the shrinking Δx, the
matrix entries a/b/c/d). Discipline-neutral, so it is kernel, not calculus:
it implements the existing `VarySettable`/`NumericHandle` protocols, and
`vary`/`expose`/`derived` consume it unchanged.

**`transformFormula(from, to)` — the deferred seam, span-scoped.** Roles in
both formulas keep span identity and route corner-to-corner; roles only in
`from` fade out, only in `to` fade in; legal iff they share ≥1 role. Not a
term-rewriting engine — the minimum the one FTC turn needs.

**Candidate verbs that DISSOLVED** (the vocabulary being right, confirmed
negatively): `onCondition`/`onApproach` are emergent — a region's fill keyed
to its SIGNED area makes det → 0 collapse and det < 0 flip happen on their
own; `Control.slider` is `expose({as: "sliders"})`; `track` is
`View.readout`; `Transform.apply/animate` is `morph`; a symbolic expression
string is an authored closure (`Calc.fn`), needing no CAS.

**What execution then caught that typechecking could not:**

- **`overlay` had to become a shared coordinate frame.** For discrete views it
  was z-order only. Its first frame-providing child now establishes the frame;
  and "ambient = the last plot built" is *wrong* the moment a program plots two
  functions, so a plot claims the frame for the object it projects.
- **Playback must rewind varied parameters.** `vary` advances its target at
  authoring time, so a live-reading view mounted at beat 1 displays what beat 5
  left behind. The player now rewinds each varied parameter to its first
  recorded `from`. Discrete views dodged this by snapshotting per step;
  continuous ones cannot, because reading live is exactly what makes a drag
  work.
- **One KaTeX pass, not one per fragment.** Per-fragment rendering demands
  standalone-valid TeX; `\frac{` · ΔA · `}{` · Δx · `}` has none. Roles are now
  wrapped in `\htmlClass` inside a single render — the addressable-span
  contract is unchanged, the math typesets.
- **A spike that had only ever been typechecked was wrong.** The determinant
  program linked a formula span role it never declared; `span(role: string)`
  accepts any string, so it failed on first execution. Authorability acceptance
  is not executability acceptance.

---

## Step navigation — beats, seek, and the 0ms contract (2026-07-22)

Artifacts used to play as one uninterruptible timeline walk: a few seconds,
~450ms per idea, no way for a student to keep up or go back. An explanation is
now segmented into **beats** the student pages through. Four claims carry the
design, and each of them is load-bearing for whoever touches the player next.

**A beat is a timeline marker, not a container.** `lesson.beat(title)` enqueues
an ordinary flat `ActionStep` with `op: 'beat'` and payload `{ title, index }`.
Making it a nesting node was the obvious move and it is wrong: `Timeline`'s
container stack (`collect()`) only supports builders that take a callback, and
`beat()` is called flat between statements. A marker keeps `timeline.root` flat,
so every existing walker — `scanReveals`, `rewindVariedParameters`,
`findLoopSubject`, `supersede.ts` — keeps working untouched, and the player's
`execVerb` `default:` case already no-ops unknown ops.

**`beat` is annotation-class.** Like `say` and `link`, it never calls
`noteAnimatingStep`, so it cannot supersede an open-ended ambient loop. That is
what lets the picture keep breathing while the student is parked at a boundary —
verified in the corpus, where a marker sits between the Markov equilibrium loop
and the next beat without killing it.

**Seek is forward-only, deliberately.** `seek(k)` silently fast-forwards
`0..k-1` and animates `k`. Backward navigation is *rebuild*: tear down the VM,
fresh world/stage/scope, re-author the program, `seek(target)` on the new
player. A program's top level authors once, so replay means rebuilding, not
rewinding — the same reason the old `Replay` button already worked this way.
`seek()` throws on a backward target rather than silently misbehaving.

**Fast-forward has an explicit 0ms contract — do not break it.** `animate.ts` is
WAAPI + rAF, not CSS transitions. At `ms = 0` the promises do settle and the
final state happens to be right, but it costs a frame per step and depends on
the document rendering — a backgrounded tab could hang a long fast-forward — and
`tweenNumber` divided by zero. Every primitive short-circuits *before* touching
WAAPI/rAF, applying the lasting effect and resolving synchronously.

Default playback pauses at every boundary: one beat plays, then it parks.

| Layer | What it owns |
| --- | --- |
| `packages/lesson` | `beat(title)` verb, `BeatPayload` |
| `packages/render` | `segments.ts` (pure), `Player.next/seek/fastForward/init`, the 0ms contract in `animate.ts`, `verify/seek.mjs` |
| `packages/host` | `beats-required` lint rule, `lint(source, { expectedBeats })` |
| `packages/planner` | law 11, the `api-reference.ts` entry, `expectedBeats` threaded `generateProgram` → `compileProgram` → `lint` |
| `apps/web` | the navigator: `Step N of M` + title, Back/Next, tick rail, ←/→, `paused` and `seeking` states |

The gated invariant, checked per example in `apps/web/verify/screenshot.mjs`:
**landing on beat k by jumping backward matches having stepped forward to k.**

Two known gaps, decided rather than discovered. A loop whose superseder lives
*inside* the segment being played stops a beat later than it would on straight
play — same end state, briefly different motion. And `seeking` is effectively
invisible, because rebuild + fast-forward finishes in under ~50ms on these
programs with the wasm module cached; it will matter when lessons get longer.

---

## The conversational layer — scene manifest and the authoring log

A lesson and a conversation are the same artifact: an **ordered log of
authoring acts**, some fragments the model wrote, some events the student's
hands produced. `state = fold(log)`, which is true only because the linter
enforces determinism (no `Date`, no `Math.random`, no I/O) — so a turn needs no
long-lived sandbox session, and replaying a log reproduces a scene rather than
approximating one.

Three pieces, and one rule each:

- **The scene manifest** (`packages/render/src/manifest.ts`). There is no
  registry of minted handles — `IdRegistry` keeps counters, not objects — so
  the manifest does not enumerate the world. It walks the two places that
  retained references: `stage.views`, and the timeline, whose step payloads
  hold the LIVE host objects. Reading `.value` off those is what makes student
  drags visible for free, because a drag calls `setValueLive` on the very
  object the timeline points at. The boundary that falls out: **an object never
  shown, varied, exposed, mentioned or linked is invisible** — and so it is to
  the student.

- **Claim evidence.** A verdict is reached one of three ways —
  `exact-comparison`, `sampled` (agreement within a tolerance, at the current
  values), `authored-predicate` (a closure the model wrote; the engine ran it,
  nobody checked it) — and they are not interchangeable. An unlabeled
  `holds: true` invites a model to narrate an opinion as a proof.

- **The log** (`packages/host/src/conversation.ts`). ORDER is load-bearing: a
  turn-2 fragment may be authored *against* a value the student had already
  dragged, so "replay the fragments, then apply the current values" is wrong by
  construction. Events are entries, interleaved. The transaction is one rule —
  fold the CANDIDATE log headlessly first; on rejection the previous log is
  returned untouched, so nothing is half-applied.

Two constraints a fragment inherits, both discovered rather than designed:
`QuickJSHost.run` evaluates in the guest's **global scope**, so every turn must
be its own function scope (esbuild's `format: 'iife'` already does this) — from
which it follows that a fragment cannot see earlier bindings and `M.byId` is
the only way back. And `M.byId` resolves against the manifest's own index,
which gives cross-turn reference exactly the right boundary: a fragment can
name what the student was shown, and cannot resurrect a retired object.

---

## The critical engineering problem — interaction-time failure

With live closures this is **critical path, not later hardening**. A program can
throw at frame 200 of a drag: divide-by-zero on a singular matrix, an unbounded
loop, mismatched dimensions. "Fail the whole answer" is wrong once the answer has
already rendered.

- **Static lint at generation** — parse, scope resolution, known functions,
  arity, obvious unbounded loops. Lint failure fails the artifact. Fail-fast
  still applies *here*.
- **Per-frame runtime budget** — QuickJS's interrupt handler fires every N
  bytecode ops and throws into the guest; the host keeps the last good frame.
  Max iterations / objects / wall-time per frame, NaN-safe arithmetic. Degrades
  gracefully: freeze, clamp, or skip the frame. The drag never dies.
- **Object-boundary invariants** (spike addition) — semantic constructors
  declare interaction policies (`editable: "renormalize-row"`) so
  invariant-breaking states are unreachable *before* the budget ever matters.
  The lint/prompt should steer the LLM toward declared policies over raw
  parameter exposure.

```ts
rt.setInterruptHandler(() => Date.now() - frameStart > BUDGET_MS);
```

### Performance tiering

Sandboxed JS runs roughly 10–50× slower than native. Fine for partition
predicates, label functions, and structural closures. Not fine for a per-frame
closure over 1,000 flow particles. Expect a split: **closures for structure and
semantics, a fast path for hot numeric inner loops** — as a *performance* tier
the runtime chooses, **not** a second authoring rule the LLM must learn.

The spikes named the first fast-path customers: **reactive derived numerics**
— `Prob.stationary(chain)` re-running power iteration per frame while a matrix
cell is dragged (and the eigen/SVD family behind it). These belong to library
code the engine can host natively; only their *inputs* cross the sandbox
boundary.

---

## Migration — hard cut below the planner

The codebase is ~5.8k lines; small enough to replace outright. The cut is clean
*below* orchestration:

| Survives | Replaced |
|----------|----------|
| `plan.ts` — `AnswerPlan` as steering/inspection point | `scene.ts` / `scene3d.ts` — fixed declarative vocabulary |
| `harness.ts` — generation orchestration, per-step calls | `validate.ts` / `validate3d.ts` — the Zod gate on scenes |
| | `capabilities.ts` — the registry |
| | `render2d.ts` / `render3d.ts` / `camera3d.ts` |
| | `eval.ts` / `expr.ts` / `scene-eval.ts` |

Accepted cost of the hard cut: working renderer detail — label placement, the
KaTeX overlay, 3D camera behavior — is tedious to re-earn. Chosen anyway for a
clean end state with no straddling.

### Orchestration

`AnswerPlan` stays as the steering and inspection point above the engine. The
per-step payload changes from declarative JSON to a lesson program:

```
AnswerPlan { topic, summary, mode, space, disciplines, steps[], style? }   KEEP
  step → declarative JSON scene                                            DROP
  step → lesson program (TypeScript)                                       NEW

gate:  Zod validation on emitted scene   →   static lint on program
                                             + runtime diagnostics
```

Steps without `carries` stay independent ⇒ parallel; carried chains serialize.

---

## Build order

Revised after the spikes. Each milestone lands with tests; the two spike
programs are the running acceptance target throughout.

1. **`packages/core` — identity, values, reactivity, correspondence.**
   Handle/ID scheme · immutable values with lazy `(operation, inputs)`
   provenance · `Slot<T>` · reactive `Collection` · dirty-propagation
   recompute · correspondence graph (by-construction + authored edges) ·
   timeline structure (implicit sequence, `cascade`/`parallel`/pace, loops).
   Pure TS, no rendering, heavily unit-tested. The spike `api.ts` files are
   the starting type surface.
2. **Kernel verbs over the core** — the 13 verbs as timeline-step operations;
   the morph-legality checker (correspondence reachability); `demonstrate` as
   lazy trace replay; `compareExperiment`'s lockstep execution.
3. **Renderer — DOM/SVG-first, discrete structures first.** Tokens, buckets,
   node-edge graph with autolayout, table, matrix, bars, history; KaTeX with
   role-addressable spans; delta animation driven by the reactive graph.
   Spike evidence: discrete structures carried both theorems — plots come
   *after*, canvas/3D re-earned later still.
4. **First discipline libraries in userland** — automata + probability,
   extracted from the spike sketches, then **both `beats.ts` programs run
   end-to-end in a browser. This is the parity gate.**
5. **QuickJS host** — the same programs executing sandboxed: marshalling, the
   interrupt budget, the numerics fast path. Until this lands, hand-authored
   programs run in-process behind a `Host` interface — a sequencing choice,
   not a reversal of decision #2; no LLM-generated code executes before the
   sandbox exists.
6. **Formula morphing seam, layout growth, calculus + linear-algebra
   libraries** — driven by the FTC and determinant examples (the natural
   third spike). ✅ **DONE, gate passed 2026-07-22**: both programs run
   unmodified through QuickJS in a browser, 32/32 spot-checks.
7. **Planner swap** — per-step generation emits programs; static lint +
   runtime diagnostics replace the Zod gate.

> **Acceptance test, held open throughout:** the shape of `Slot`, provenance,
> `Correspondence`, and a view slot is determined by the worked examples, not
> by the core in isolation. Two layers now: `spikes/{myhill-nerode,markov}/beats.ts`
> are the **executable** acceptance programs (they must run, unmodified, at the
> parity gate); `docs/new_architecture/example_{2,3}.md` — FTC and determinant —
> remain the **authorability** acceptance for what the spikes left unexercised
> (plots, regions, accumulation, linear-map grids, formula morphing). If either
> layer fights the design, redesign cheaply.

---

## Deferred, with the seam left open

- **Expression-to-expression formula morphing** (`transformFormula`) — the
  addressable-span contract makes this landable later without re-authoring.
- **Constraint layout solver** — semantic templates first; add if they crack.
- **Plugin SDK / capability registration by third parties** — the two-tier
  library model is the interim answer.
- **WebGL/WebGPU, particle systems, 3D camera choreography** — Phase 3 in the
  source guidelines; not before parity.
- **Director layer** (audience / depth / rigor / emphasis knobs) —
  `AnswerPlan.style` reserves the fields; the plan pass is the single insertion
  point.
- **Verification / CAS** — dropped, not forgotten. If it returns, an `algebra`
  semantic library is its natural home. Model-authored `checks`
  (invariant/target) may return as live guards, never as a verification kernel.

---

## Reading the source guidelines

`docs/new_architecture/architecture.md` is the input document, not the plan. Its
§7 feature taxonomy (~200 bullets), six layers, and three phases should be read
as a **menu of what becomes expressible**, never as a build list. Read as
coverage, it recreates precisely the human-bottleneck registry this architecture
exists to escape: someone must hand-write `View.probabilityFlow` before the LLM
can say it. The two-tier vocabulary is the answer to that document's own
central risk.
