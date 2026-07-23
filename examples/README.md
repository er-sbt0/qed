# examples/ — what the model is shown

These are lesson programs, one per discipline. `manifest.json` says which serves
which, and `prompts.ts` injects exactly one per request, chosen by the plan's
discipline.

**They are prompt input, and nothing else.**

That is the whole contract, and it is deliberately narrow. No test asserts what
is *inside* an example — not a beat title, not an op count, not a verb choice.
The only thing enforced is that it still works:
`packages/host/src/examples.smoke.test.ts` bundles each one, runs it through the
gate and QuickJS, and checks it executes and declares the beats it opens. A
program nobody has run is not an honest thing to show the model; past that, the
content is yours.

## Replacing one is a command, not an editing session

```
./run.sh record "Why does BFS find shortest paths?"     # BILLED: one generation
```

If it gates, the program it produced lands as `examples/<slug>/`, takes over its
discipline's manifest slot, deletes whatever held that slot before, and is
re-inlined into the prompt — all of it, no second command. If it does *not*
gate, nothing under `examples/` moves and the gate's complaint is printed in
full: that is a finding about the engine, and the cassette the run just wrote is
the free way to re-check it after a fix.

A recorded directory holds `beats.ts` (the program, verbatim as the model
emitted it) and `meta.json` (question, discipline, model, timestamp, and which
cassette it came from — so nobody has to guess where a program came from).

Hand-writing one still works and breaks nothing: a directory with a `beats.ts`
and a manifest line is a valid example, and the older ones here are exactly
that. But reach for `record` first. The point of a corpus is to show the model
what *the current engine* makes possible, and a recording demonstrates that by
construction while a hand-written program only claims it.

## Why it works this way

The examples are the strongest single lever on generation quality and the
fastest thing in the repo to rot. Add a verb to the vocabulary and the corpus
does not know about it; remove one and the corpus is actively teaching the model
to fail. A hand-maintained corpus answers "what did someone think good looked
like, back then". A recorded one answers "what does this engine produce today",
which is the question the generate → gate → execute → repair loop actually
exists to settle.

So nothing here is precious and nothing here is load-bearing. No test names an
example. No gate needs a particular one to exist — `./run.sh verify` walks the
newest recording unless `--example=<dir>` says otherwise, and `./run.sh remount`
mounts whatever is present. Delete one and its discipline falls back to another
example until you record a replacement.

## What pins engine behaviour instead

Engine regressions are caught by fixtures the engine owns, under
`packages/*/src/__fixtures__/`. Those are frozen on purpose and asserted against
in detail — and they are what lets these examples stay soft. If you ever find
yourself unable to re-record because a test asserts an example's contents, that
test is misplaced: move its input into a fixture.

## Adding a discipline

`manifest.json` is keyed by the disciplines in `packages/planner/src/plan.ts`.
Record a question in a discipline with no example yet and it claims the slot. A
discipline with no example falls back to the calculus one — worse, never broken.

After a hand-edit (unnecessary after `record`, which does it for you), re-inline
the copy the prompt reads and commit it:

```
./run.sh examples          # pnpm --filter @math-ai/planner build:examples
```
