#!/usr/bin/env bash
#
# run.sh — convenience runner for the Reactive Math Canvas monorepo.
#
# Node/pnpm live under nvm and aren't on PATH by default, so this script wires
# them up first, then dispatches a subcommand.
#
# Usage:
#   ./run.sh            # start the web app in dev mode (http://localhost:3000)
#   ./run.sh dev [port] # dev server on an optional port
#   ./run.sh build      # production build of the web app
#   ./run.sh start [port]  # serve the production build
#   ./run.sh test       # run all package unit tests (~5s — the inner loop)
#   ./run.sh typecheck  # strict tsc --noEmit across packages
#   ./run.sh examples   # re-inline examples/ into the prompt (free)
#   ./run.sh regenerate # wipe examples/ and re-record the corpus (BILLED)
#   ./run.sh install    # install workspace dependencies
#
# Browser gates. THE DEFAULT IS FAST: playback runs at ?speed=20 and nothing is
# written to disk. That is still a real run — Player.ms() floors a step at 24ms,
# so every view mounts and every transition fires; only the waiting is gone.
#
#   ./run.sh verify              # the app gate — deep and narrow: one example, seeked
#   ./run.sh verify --example=X  # ...walk that example instead of the newest
#   ./run.sh remount             # shallow and wide: every example mounted — free
#   ./run.sh gate                # every gate at full fidelity, with images
#   ./run.sh verify --live       # + real generation, 4 fixed topics (BILLED)
#   ./run.sh record "<q>"        # ONE generation → cassette + example (BILLED)
#   ./run.sh regenerate          # wipe examples/ and re-record the corpus (BILLED)
#
# These start a dev server on :3210 and tear it down; one already listening
# there is reused and left alone, which is worth ~10s of Next cold compile.
#
# A cassette is real model output kept on disk, replayed for free by
# `./run.sh test`. It is how a gate/extractor/lint change gets checked against
# genuine model text without billing a generation — record once, replay forever.
# See packages/planner/src/cassettes/README.md.
#
# NOTHING under examples/ is hand-maintained content any more. Every example is
# a recording, replaceable by re-running `record` on a better question. No test
# asserts what is inside one, so nothing here pins a lesson: the engine is what
# is under development, and the corpus follows it.
#
set -euo pipefail

cd "$(dirname "$0")"

# --- make node/pnpm available (nvm-managed, not on PATH) ---
if ! command -v pnpm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    nvm use default >/dev/null 2>&1 || nvm use node >/dev/null 2>&1 || true
  fi
  # Fall back to the known install location if nvm didn't put node on PATH.
  for bin in "$NVM_DIR"/versions/node/*/bin; do
    [ -x "$bin/node" ] && export PATH="$bin:$PATH"
  done
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@9 --activate >/dev/null 2>&1 || true
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: could not find pnpm (looked under \$NVM_DIR=$NVM_DIR)." >&2
  echo "       install Node via nvm, then: corepack enable" >&2
  exit 1
fi

echo "• node $(node --version)  pnpm $(pnpm --version)"

# --- install deps on first run ---
if [ ! -d node_modules ]; then
  echo "• installing dependencies…"
  pnpm install
fi

cmd="${1:-dev}"
shift || true

case "$cmd" in
  dev)
    port="${1:-3000}"
    echo "• starting dev server on http://localhost:$port"
    exec pnpm --filter @math-ai/web exec next dev -p "$port"
    ;;
  build)
    exec pnpm --filter @math-ai/web build
    ;;
  start)
    port="${1:-3000}"
    echo "• serving production build on http://localhost:$port"
    exec pnpm --filter @math-ai/web exec next start -p "$port"
    ;;
  test)
    # One vitest across all six package projects (see vitest.workspace.ts), not
    # six cold starts. Per-package `pnpm --filter <pkg> test` still works.
    exec pnpm exec vitest run "$@"
    ;;
  record)
    # BILLED: one real generation. It writes TWO artifacts, and the second one
    # is why you would run this on a working day:
    #
    #   1. a cassette  — the raw responses, replayed for free by `./run.sh test`
    #   2. an example  — the program itself, into examples/, IF it gated
    #
    # (2) makes the few-shot corpus a function of the current engine instead of
    # a museum. One example per discipline, newest recording wins, the
    # superseded directory deleted (git still has it). A generation the gate
    # REJECTED is promoted to nothing — it stays a cassette, which is the more
    # valuable kind anyway, and the gate's complaint is printed in full.
    #
    #   ./run.sh record "Explain the pigeonhole principle"
    #   ./run.sh record "..." --slug=pigeonhole
    #
    # Re-inlining into the prompt is automatic — the `examples` step below runs
    # straight after. Commit examples/, the manifest, the cassette and the
    # regenerated examples.generated.ts together.
    #
    # Needs ANTHROPIC_API_KEY. See packages/planner/src/cassettes/README.md and
    # packages/planner/src/promote.ts.
    q="${1:-}"
    if [ -z "$q" ]; then
      echo "usage: ./run.sh record \"<question>\" [--slug=name]" >&2
      exit 2
    fi
    shift
    slug=""
    for arg in "$@"; do
      case "$arg" in
        --slug=*) slug="${arg#--slug=}" ;;
      esac
    done
    echo "• BILLED: one real generation — \"$q\""
    RECORD_QUESTION="$q" RECORD_SLUG="$slug" \
      pnpm --filter @math-ai/planner exec vitest run src/record-cassette.test.ts
    # Unconditional, and cheap: if the recording promoted an example the prompt
    # must see it, and if it did not this is a no-op over unchanged files. The
    # alternative — asking the caller to remember a second command after a
    # BILLED run — is how examples.generated.ts drifts from examples/.
    echo "• re-inlining examples into the prompt…"
    exec pnpm --filter @math-ai/planner build:examples
    ;;
  regenerate)
    # BILLED: throw the whole corpus away and re-record it against the CURRENT
    # engine. `record` refreshes ONE discipline; this refreshes the corpus.
    #
    #   ./run.sh regenerate                    # the default questions below
    #   ./run.sh regenerate "<q1>" "<q2>" ...  # those questions instead
    #   ./run.sh regenerate -y                 # skip the confirmation
    #
    # Why wipe first rather than let promote.ts replace slot by slot: a
    # discipline whose recording is not re-run keeps a program written by an
    # older vocabulary, and the whole point of the corpus is to answer "what
    # does this engine produce TODAY". Emptying the manifest makes that
    # honest — a discipline with no recording falls back to another example
    # (see prompts.ts exampleFor), which is worse but never stale.
    #
    # Nothing is re-inlined between recordings, deliberately: each generation
    # in the run is shown the same few-shot corpus (the committed
    # examples.generated.ts), so a weak first recording cannot teach the
    # second one. The single re-inline happens at the end, and only if at
    # least one program gated — otherwise examples.generated.ts would be
    # emptied by a run that produced no replacement, and the recovery is
    # `git checkout examples/`.
    yes=""
    questions=()
    for arg in "$@"; do
      case "$arg" in
        -y|--yes) yes=1 ;;
        *) questions+=("$arg") ;;
      esac
    done
    if [ ${#questions[@]} -eq 0 ]; then
      # Two questions, two disciplines — the pair the corpus was last recorded
      # from, so a regenerate is a like-for-like reading of what changed in the
      # engine since. Pass your own to move the corpus somewhere else.
      questions=(
        "Why does a Markov chain converge to a stationary distribution?"
        "Why is a graph bipartite if and only if it contains no odd cycle?"
      )
    fi
    echo "• BILLED: ${#questions[@]} real generation(s), and examples/ is deleted first:"
    for q in "${questions[@]}"; do echo "    - $q"; done
    if [ -z "$yes" ]; then
      printf "• proceed? [y/N] "
      read -r reply
      case "$reply" in [yY]*) ;; *) echo "• aborted — nothing deleted, nothing billed."; exit 1 ;; esac
    fi
    echo "• emptying examples/ (git still has it)…"
    node -e '
      const { readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      for (const e of readdirSync("examples", { withFileTypes: true })) {
        if (e.isDirectory()) { rmSync(join("examples", e.name), { recursive: true, force: true }); console.log("  removed examples/" + e.name); }
      }
      const m = JSON.parse(readFileSync("examples/manifest.json", "utf8"));
      writeFileSync("examples/manifest.json", JSON.stringify({ ...m, examples: [] }, null, 2) + "\n");
    '
    promoted=0
    failed=()
    for q in "${questions[@]}"; do
      echo "• recording \"$q\"…"
      if RECORD_QUESTION="$q" RECORD_SLUG="" \
         pnpm --filter @math-ai/planner exec vitest run src/record-cassette.test.ts; then :; else
        failed+=("$q")
      fi
    done
    promoted=$(node -e 'const {readFileSync}=require("node:fs");console.log(JSON.parse(readFileSync("examples/manifest.json","utf8")).examples.length)')
    if [ ${#failed[@]} -gt 0 ]; then
      echo "• the recorder errored on ${#failed[@]} question(s):"
      for q in "${failed[@]}"; do echo "    - $q"; done
    fi
    if [ "$promoted" -eq 0 ]; then
      echo "• NOTHING gated — examples/ is empty and the prompt still holds the old corpus." >&2
      echo "  The complaints above are the finding. Recover with: git checkout examples/" >&2
      exit 1
    fi
    echo "• $promoted example(s) promoted — re-inlining into the prompt…"
    exec pnpm --filter @math-ai/planner build:examples
    ;;
  examples)
    # Re-inline examples/*/beats.ts into the generation prompt. FREE — no API,
    # no browser. Run it after editing anything under examples/, and commit the
    # generated file: the web app must not read the repo at runtime.
    exec pnpm --filter @math-ai/planner build:examples
    ;;
  verify)
    # The app gate owns its own server; everything else is a flag passthrough.
    exec pnpm --filter @math-ai/web exec node verify/screenshot.mjs "$@"
    ;;
  remount)
    # Mount every examples/ program in a real browser. Free — no generation, no
    # key. `verify` walks ONE example deeply because seek and rebuild are host
    # properties; this one is shallow and wide, so editing an example — the
    # thing we most want to be cheap — gets a browser answer in seconds.
    exec pnpm --filter @math-ai/web exec node verify/remount.mjs "$@"
    ;;
  gate)
    # The full record: every gate, real-time pacing, images on disk. Minutes,
    # by design — this is what you run before calling a milestone passed, not
    # what you run after every edit.
    echo "• building the demo bundles…"
    pnpm --filter @math-ai/render demo:build
    pnpm --filter @math-ai/library verify:build
    pnpm --filter @math-ai/host verify:build
    echo "• render: demos + seek"
    pnpm --filter @math-ai/render exec node verify/screenshot.mjs --shots "$@"
    pnpm --filter @math-ai/render exec node verify/seek.mjs --shots "$@"
    echo "• library: parity"
    pnpm --filter @math-ai/library exec node verify/screenshot.mjs --shots "$@"
    echo "• host: sandboxed parity"
    pnpm --filter @math-ai/host exec node verify/screenshot.mjs --shots "$@"
    echo "• app: the beat walk"
    exec pnpm --filter @math-ai/web exec node verify/screenshot.mjs --shots "$@"
    ;;
  typecheck)
    # --parallel, not topological: every package typechecks its own SOURCES and
    # consumes no other package's build output, so the ordering `pnpm -r` pays
    # for buys nothing. Seven serialized tsc processes were 13s of CPU squeezed
    # through 2 cores; run them at once and it is 2.4s. A failure in any package
    # still exits non-zero and still names the package.
    exec pnpm -r --parallel typecheck
    ;;
  install)
    exec pnpm install
    ;;
  *)
    echo "usage: ./run.sh [dev|build|start|test|examples|record|regenerate|verify|remount|gate|typecheck|install] [port]" >&2
    exit 2
    ;;
esac
