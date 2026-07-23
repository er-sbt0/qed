# `__fixtures__/` — programs the engine owns

One lesson program, `nerode/`, held **frozen on purpose** as the input to the
acceptance test beside it. It began as a copy of a program that was then under
`examples/`, and the copy is the point.

An acceptance test asserts in detail: these beat titles, this many `slot:set`
ops, mass conserved across this cascade, this morph legal. That is exactly the
kind of assertion you want about the *engine* — and exactly the kind that must
never be pointed at `examples/`. Examples are recorded model output now
(`./run.sh record`), replaced wholesale whenever the vocabulary moves; a strict
test aimed at one would fail every time someone improved what the model sees,
for reasons having nothing to do with the engine.

So the two are split. `examples/` is prompt input and changes freely
(`packages/host/src/examples.smoke.test.ts` only checks it still runs). What
lives here is engine input and changes only when you mean to change what the
engine guarantees.

## Working with them

- **Editing a fixture is editing a test.** Expect assertions to move with it,
  and only do it when the engine's behaviour genuinely changed.
- **It is not an example.** Nothing here reaches the model. Don't keep it
  pretty, and don't sync it with `examples/` — those are recordings and will
  drift by design.
- **It may shrink.** It is a whole ~150-line program because that is how the
  coverage was originally written. A fixture trimmed to just the construction a
  test actually asserts is strictly better; that refactor is welcome, one test
  at a time.
- **It may gain siblings.** There was a second fixture here (a Markov program)
  and it was deleted along with the acceptance test that read it, deliberately:
  a frozen lesson is a thing agents mistake for content worth preserving, and
  the cost of that mistake was judged higher than the coverage. If you add
  another, add it for a guarantee the nerode program cannot express — not for
  the sake of a second topic.
- **`api.ts` per fixture is deliberate.** Each is its own module so it captures
  the program scope active at *its* import moment. A single shared shim would
  bind once, and a second program would author into the first one's world.
