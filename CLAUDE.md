# math-ai — working notes

Reactive Math Canvas: an LLM writes a TypeScript *lesson program*, it is linted
and gated, then executed in a QuickJS sandbox and played back on a DOM/SVG
stage. `packages/` holds the engine, `apps/web` is the Next app around it.

## The work is the engine ↔ LLM loop

We are in early development. The product question — *can a model reliably write
a correct, renderable lesson program from a question?* — is decided in the
generate → gate → execute → repair path. That is where effort belongs:

| what | where |
| --- | --- |
| the vocabulary the model is handed | `packages/planner/src/api-reference.ts` |
| system prompts, plan shape | `packages/planner/src/prompts.ts`, `plan.ts` |
| plan + program calls | `packages/planner/src/generate.ts` |
| extract / shape / syntax | `packages/planner/src/compile.ts` |
| the static gate the program must survive | `packages/host/src/lint.ts` |
| sandbox execution, runtime errors that feed repair | `packages/host/src/bridge.ts`, `prelude.ts`, `guest-error.ts` |
| the round trip in the app | `apps/web/app/api/chat/route.ts`, `api/repair/route.ts` |
| the affordances a program can reach for | `packages/library/src/*`, `packages/lesson/src/*` |
| the reactive cell, for any type | `packages/library/src/live.ts` |
| a conversational turn: scene → prose | `packages/render/src/manifest.ts`, `api/followup/route.ts` |
| a conversational turn: scene → fragment | `packages/host/src/conversation.ts`, `planner/src/intent.ts` |

When a generated program fails, the fix is almost always in that table — a
missing affordance, a vocabulary the reference doesn't teach, a lint rule that
rejects something legal. Fix it there, not in a lesson.

## Two kinds of lesson program, and the difference matters

Programs live in exactly two places, with opposite rules. Getting these confused
is the single easiest way to waste a session here.

### `examples/` — prompt input. Regenerate it; don't curate it.

These are the few-shot examples the program pass shows the model.
`examples/manifest.json` says which one serves which discipline, and `prompts.ts`
injects exactly ONE per request, indexed by the plan's discipline.

**They are recorded model output, not authored content.** One billed generation
writes both a cassette and — if the program gated — the example itself:

```
./run.sh record "Why does BFS find shortest paths?"    # BILLED
```

It claims that discipline's slot, deletes whatever held it before (git still
has it), and re-inlines into the prompt automatically. A generation the gate
REJECTED is promoted to nothing; the complaint is printed in full, and that
complaint is the finding. See `packages/planner/src/promote.ts`.

Nothing asserts what is inside an example. The only test that reads them,
`packages/host/src/examples.smoke.test.ts`, loops the manifest and checks the
contract an example actually owes — it gates, it executes in QuickJS, every beat
it authors lands, it says and shows something. No beat titles, no op counts, no
example named anywhere, and no gate depends on a particular one existing.

So when generation keeps failing the same way, the move is: fix the engine or
the vocabulary, then **re-record** — which proves the fix in the corpus instead
of asserting it. Hand-editing a `beats.ts` still works (older examples here were
written that way) but is the second choice, and it makes that directory's
`meta.json` inaccurate. After a hand-edit run `./run.sh examples` and commit the
generated file; after `record` that already happened.

### `packages/library/src/__fixtures__/` — engine input. Frozen on purpose.

The acceptance test asserts against `nerode/` in detail: exact beat titles, op
counts, morph legality. It is a copy of a program that was once an example, and
free to drift from anything under `examples/`.

Editing a fixture is editing a test. Do it only when the engine's behaviour
genuinely changed. If you ever find yourself unable to re-record an example
because a test asserts its contents, that test is misplaced — move its input
into a fixture rather than freezing the example.

There used to be a second fixture (Markov) with its own acceptance tests, and a
Markov example to match. All of it was deleted deliberately: a frozen lesson
reads as content to preserve, and sessions kept treating the corpus as the
product instead of the engine. Do not reintroduce one to "restore coverage" —
add coverage the fixture cannot express, or add it as a unit test.

### Still not work

- **Don't read a program to learn the API.** `api-reference.ts` is the source of
  truth for what a program may say; the fixtures in particular are frozen and
  may predate the current vocabulary.
- **Don't polish a generated lesson** because it reads awkwardly. Prose quality
  in a saved artifact is not a defect. If it reveals an *engine* gap, fix the
  engine.
- **Don't run a billed path to check an unrelated change.** See below.

## Where the prose lives

This file is the live entry point and the only one kept current. `docs/` now
holds two files: `docs/visual.md` — the single live direction (make the LLM
author beautiful, essence-carrying math figures) — and `docs/architecture.md`,
which describes the engine as it is. Where the two disagree, `visual.md` is the
intent and `architecture.md` the present. The old planning docs (vision,
roadmap, direction) were deleted; git has them. The root holds no planning prose.

## Node is not on PATH

node/pnpm live under nvm. **Use `./run.sh <cmd>`** — it wires them up first.
A bare `pnpm test` will fail with "command not found".

## Testing: reach for the cheap tier

**Unit tests — ~2s, no browser. This is the loop.**

```
./run.sh test          # ONE vitest over six projects (see vitest.workspace.ts)
./run.sh typecheck     # strict tsc --noEmit, all packages in parallel (~2.4s)
```

Almost every change to `packages/*` can be proven here. Vitest, `*.test.ts`
beside the source. `pnpm --filter <pkg> test` still works for one package.

This tier now covers the generation pipeline too, which used to need a billed
run. `packages/planner/src/cassettes/*.json` hold raw responses from real
generations; `replay.test.ts` runs each one through the CURRENT gate for free.
That is the regression check for the extractor, the shape rules, `lint.ts`, and
the repair brief — a lint rule that starts rejecting something legal fails here,
with a real program behind it.

Replay is keyed on call order, not prompt text, so editing `api-reference.ts`
does not invalidate cassettes. The flip side: a replay says nothing about
whether the *prompt* got better. Only a billed run answers that.

**Browser gate — ~10s, only when the browser is the point.**

```
./run.sh verify               # the newest recording. The default, normally the only one.
./run.sh verify --example=ftc # ...that directory instead
./run.sh remount              # every example, mounted through /playground
```

`verify` is deep and narrow: one example, walked beat by beat, seeked, rebuilt,
paged with the arrow keys. What that proves — Next bundling, the QuickJS wasm
variant, real CSS/theme, KaTeX layout, the stepped player, seek — is a property
of the HOST, not of the lesson, so one lesson exercises it and a second would
only re-prove it. It names no lesson: whichever example was recorded most
recently is the one walked, so the gate follows the corpus instead of pinning
part of it.

`remount` is shallow and wide: every program in `examples/` mounted and played
to the end. It exists because `examples/` gets replaced wholesale — the unit
tier runs those programs through QuickJS against a headless stage, which says
nothing about whether they still draw. Both are free and neither needs a key.

Both start a dev server on :3210 and tear it down; one already answering there
is reused (health-checked with an HTTP GET, not a TCP connect — a `next dev`
killed mid-compile keeps the port bound and never answers). Leaving
`./run.sh dev 3210` up while you iterate is free speed.

**Waiting is a bug.** If a gate is slow, the fix is a shorter timeout, a higher
speed divisor, or fewer captures — not patience. `scripts/verify/driver.mjs`
owns flag parsing, Chromium lookup, server lifecycle and the PASS/FAIL tally;
new gates import it rather than growing their own copy.

### Why the fast path is still a real test

Playback defaults to `?speed=20`, which `LessonCanvas` reads off the URL. Not a
skipped run: `Player.ms()` floors every step at 24ms on purpose (see
`packages/render/src/player.ts:358`), so views still mount, animations still
execute, every state transition still fires. Only the pacing is gone. Do not
replace this with instant mode — the floor is what keeps a fast run honest.

`--shots` writes PNGs and drops back to real-time pacing. Opt-in, gitignored;
evidence to look at, not artifacts to diff.

### The billed paths, named so they are never accidental

```
./run.sh record "<question>"    # BILLED: ONE generation → cassette + example
./run.sh verify --live          # BILLED: real generation through the app
node scripts/eval-harness.mjs   # BILLED: plan/gate eval, no browser
./run.sh gate                   # every gate, full fidelity — minutes. Milestones only.
```

Ask before running any of these. They cost money per run, and none of them is
the right way to check an engine change.

`record` is the one worth spending on deliberately, and it now buys two things
from one generation: a permanent free test (the cassette) and, when the program
gates, the refreshed few-shot example. That is the intended way to move the
corpus forward — change the engine or the vocabulary, then re-record.

The two artifacts want opposite outcomes, which is worth holding in mind.
**Failures make the best cassettes**: a generation the gate rejected pins a real
defect that costs nothing to re-check, and tells you when a fix actually landed.
**Only successes become examples**: a rejected program is exactly what the model
must not be shown. So a failed recording is not a wasted run — it bought the
more valuable half.
