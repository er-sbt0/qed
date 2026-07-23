# cassettes/ — real model output, replayed for free

Each file here is one billed generation, kept. A cassette holds the question and
the raw responses the model gave for it, in call order, plus what the pipeline
made of them at recording time.

`replay.test.ts` runs every cassette through the *current* gate in the ~1.5s
unit tier — no API key, no network, no cost. That is the loop for anything that
post-processes model output: the extractor, the shape rules, the lint gate, the
repair brief.

## Recording one (BILLED)

```
./run.sh record "Explain the pigeonhole principle"
./run.sh record "..." --slug=pigeonhole      # name it yourself
```

Needs `ANTHROPIC_API_KEY`. One run, two artifacts:

- **always** a cassette here, replayable forever for free;
- **if the program gated**, the program itself into `examples/<slug>/`, claiming
  its discipline's slot and re-inlined into the prompt automatically.

The second is why a recording is worth its cost twice over: the same billed
generation both pins the current behaviour and refreshes what the model is shown
next time. See `../promote.ts` for the three rules governing the promotion, and
`examples/README.md` for why the corpus is recorded rather than written.

Commit the cassette, the example directory, `examples/manifest.json` and the
regenerated `examples.generated.ts` together — they are one event.

## What a replay does and does not prove

**Does:** that the code around the model still handles real model output — that
a program which gated cleanly still gates cleanly, that a repair round-trip
still repairs, that a lint rule change did not start rejecting something legal.

**Does not:** tell you what the model would say *today* given a changed prompt.
Replay is keyed on call order, not on the prompt text, precisely so that editing
`api-reference.ts` does not invalidate every cassette at once. Only a billed run
(`./run.sh verify --live`, `node scripts/eval-harness.mjs`) answers "did the
prompt get better".

## The valuable ones are the failures

A cassette of a generation that *failed* — the gate rejected it, or it needed a
repair — is worth more than one that sailed through. It pins a real defect in a
form that costs nothing to re-check, and it is the thing that tells you when a
fix to the vocabulary or the gate actually landed. Record those deliberately.

The same asymmetry runs the other way for examples, which is why a rejected
generation is never promoted: the failure is the most valuable thing to keep as
a cassette and the last thing to show the model as an exemplar.

## When a replay fails

Read it as a finding first, not a stale fixture. `CassetteExhaustedError` in
particular means the pipeline now makes *more* model calls for this input than
it used to — almost always a gate that started rejecting a program it once
accepted. Look at what the gate says before re-recording.

Re-record only when you have decided the new behaviour is correct.
