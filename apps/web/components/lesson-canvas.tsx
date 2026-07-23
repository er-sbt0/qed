'use client';

/**
 * lesson-canvas.tsx — where a generated program becomes a live answer.
 *
 * This is architecture decision #2 arriving in the product: the program the
 * model wrote executes SANDBOXED, in the browser, and what it authors is played
 * by the ordinary host-side player. The sequence is the milestone-6 gate page's,
 * unchanged — fresh world, stage bound to a DOM node, program scope, QuickJS
 * context, `defineScope`, `run` — which is the point: the path the four
 * acceptance programs proved is the path an LLM program takes.
 *
 * Two things differ from the gate page, both because the program is untrusted:
 *
 *  - RUNTIME FAILURE IS REPORTED, NOT THROWN. The authoring pass can fail on a
 *    program that passed the static gate (the determinant spike did exactly
 *    that). `onRuntimeError` hands the diagnostic up so the page can offer a
 *    repair round-trip — the runtime half of "lint + runtime diagnostics
 *    replace the Zod gate".
 *  - EVERY RUN GETS A FRESH WORLD. A program's top level authors once, so
 *    replay means rebuilding, not rewinding. That also makes React's
 *    strict-mode double-mount harmless.
 *
 * PLAYBACK IS STEPPED, NOT A RUSH. `lesson.beat(title)` cut the timeline into
 * segments; this component plays exactly ONE of them and then waits. The
 * student advances. That is the whole point of the beat work — an explanation
 * a person can keep up with.
 *
 * NAVIGATION HAS TWO MECHANISMS, and the asymmetry is deliberate:
 *
 *  - FORWARD is cheap: `player.next()` (one beat) or `player.seek(i)` (skip
 *    ahead, fast-forwarding the beats in between with time switched off). The
 *    live player, the live VM, no rebuild.
 *  - BACKWARD is a REBUILD. `seek()` is forward-only by construction: a
 *    program's authoring pass runs once and the world it built is not
 *    rewindable. Going back therefore means what Replay already meant — throw
 *    the VM away, build a fresh world/stage/scope, re-run the program, and
 *    `seek(target)` on the new player, which silently replays 0..target-1 and
 *    plays `target` animated. `run` below carries both the replay counter and
 *    the target beat, so a backward jump is just another identity for the same
 *    effect.
 *
 * Ambient loops keep running while parked at a boundary — a rotating vector
 * should not freeze because the student is reading. They stop on teardown only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorld } from '@math-ai/core';
import {
  createPlayer,
  createStage,
  ensureTheme,
  sceneManifest,
  type Player,
  type SceneManifest,
} from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost } from '@math-ai/host';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';

/** The wasm module is ~1MB of embedded base64: load it once per page. */
let modulePromise: Promise<Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>> | null = null;
function quickjs() {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
  return modulePromise;
}

/**
 * What the run is doing right now.
 *
 *   booting/authoring — the sandbox is coming up / the program is running.
 *   playing           — a beat's animation is in flight.
 *   paused            — parked at a beat boundary, waiting for the student.
 *   seeking           — a jump is in flight (fast-forward, or a rebuild).
 *   done              — the last beat finished; the canvas is live and draggable.
 *   failed            — the program threw; `onRuntimeError` already fired.
 */
export type RunState =
  | 'booting'
  | 'authoring'
  | 'playing'
  | 'paused'
  | 'seeking'
  | 'done'
  | 'failed';

const STATE_LABEL: Record<RunState, string> = {
  booting: 'starting the sandbox…',
  authoring: 'running the program…',
  playing: 'playing',
  paused: 'your move — drag it',
  seeking: 'jumping…',
  done: 'ready — drag it',
  failed: 'the program failed',
};

/** The prologue segment has no title; it is the stage being set. */
const PROLOGUE = 'Setting the stage';

interface RunTarget {
  /** Bumped by Replay — forces a fresh authoring pass. */
  readonly id: number;
  /** The beat to land on after re-authoring (silently fast-forwarding to it). */
  readonly target: number;
  /** A rebuild triggered by a backward jump reads as a jump, not as a cold boot. */
  readonly jumping: boolean;
}

interface LessonCanvasProps {
  /** type-stripped program (what QuickJS evaluates) */
  js: string;
  /** the authored TypeScript (what the linter scored, and what repair edits) */
  source: string;
  /** playback speed divisor; 2 plays twice as fast. `?speed=` in the URL wins. */
  speed?: number;
  /** called when the sandboxed program throws — the repair signal */
  onRuntimeError?: (message: string) => void;
  /**
   * Handed a describer for the CURRENT scene, and `null` whenever that scene
   * goes away (teardown, replay, a backward jump — each rebuilds the world).
   *
   * A follow-up question can only be answered against the live world, and the
   * live world exists nowhere but here: the program ran in a QuickJS sandbox
   * against a host-side world in this component. So the manifest is built in
   * the browser and posted up, exactly as `onRuntimeError`'s diagnostic is.
   * Handing out a describer rather than a manifest means the caller reads the
   * scene at the moment they ask, drags included — a snapshot taken at mount
   * would be stale by the time the student had a question about it.
   */
  onSceneChange?: (describe: (() => SceneManifest) | null) => void;
}

/**
 * `?speed=20` in the URL overrides the prop, everywhere a canvas is mounted.
 *
 * This is what makes the browser gate cheap. `Player.ms()` floors every step at
 * 24ms no matter how large the divisor, so a fast run is not a skipped run:
 * views still mount, animations still execute, every state transition still
 * fires — the harness just stops waiting out the pacing. Read once, from
 * `window.location`, because playback speed is fixed for the life of a page.
 */
function urlSpeed(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('speed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function LessonCanvas({
  js,
  source,
  speed: speedProp = 1,
  onRuntimeError,
  onSceneChange,
}: LessonCanvasProps) {
  const [speed] = useState(() => urlSpeed() ?? speedProp);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const [state, setState] = useState<RunState>('booting');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunTarget>({ id: 0, target: 0, jumping: false });
  /** Beat titles, learned once the program has authored. */
  const [titles, setTitles] = useState<readonly (string | undefined)[]>([]);
  /** The beat being played or parked at; -1 until the first one starts. */
  const [step, setStep] = useState(-1);
  /** A control action is in flight. Navigation may interrupt it. */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const setBusyBoth = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    let disposed = false;
    let host: QuickJSHost | null = null;
    let stage: ReturnType<typeof createStage> | null = null;
    const { target, jumping } = run;
    container.innerHTML = '';
    ensureTheme(document);
    setError(null);
    // The beats do NOT change across a rebuild — same program, same timeline —
    // so the rail stays put. Clearing it would make the controls flicker out
    // and back on every backward jump, which reads as a crash, not a step.
    // (A repaired program arrives with a new React key: fresh mount, fresh rail.)
    setStep(jumping ? target : -1);
    // A backward jump must not look like a cold boot — the student asked for a
    // step, not a restart, so the bar says "jumping" the whole way through.
    setState(jumping ? 'seeking' : 'booting');
    setBusyBoth(true);

    void (async () => {
      try {
        const mod = await quickjs();
        if (disposed) return;

        const world = createWorld();
        stage = createStage(world, container);
        const scope = createProgramScope(world, stage);
        const built = stage;

        host = new QuickJSHost(mod.newContext(), { budget: { authorMs: 10_000, frameMs: 16 } });
        host.defineScope(scope as unknown as Record<string, unknown>);

        if (!jumping) setState('authoring');
        // The gate already linted this source; re-linting here would reject the
        // artifact a second time for the same reason, so the run is the point.
        host.run(js, { lintSource: source });
        if (disposed) return;

        const player = createPlayer(stage, scope.lesson, {
          speed,
          onSegment: (event) => {
            if (disposed) return;
            setStep(event.index);
            if (event.phase === 'start') {
              setState(event.instant ? 'seeking' : 'playing');
            } else if (!event.instant) {
              setState(player.atEnd ? 'done' : 'paused');
            }
          },
        });
        playerRef.current = player;
        // only after a successful authoring pass: a scene that threw is not a
        // scene anyone should be answering questions about.
        onSceneChange?.(() => sceneManifest(built));
        player.init();
        setTitles(player.titles);

        // `seek` is the single entry point for both cases: seek(0) on a fresh
        // player is exactly "play the first beat", and seek(k) replays 0..k-1
        // instantly before animating k.
        await player.seek(Math.min(target, player.segmentCount - 1));
        if (disposed) return;
        setState(player.atEnd ? 'done' : 'paused');
      } catch (err) {
        if (disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        setState('failed');
        setError(message);
        onRuntimeError?.(message);
      } finally {
        if (!disposed) setBusyBoth(false);
      }
    })();

    return () => {
      disposed = true;
      // The VM outlives playback (interaction re-enters guest closures), so it
      // is only torn down when the canvas itself goes away.
      try {
        playerRef.current?.stopAmbient();
      } catch {
        /* nothing to stop */
      }
      playerRef.current = null;
      onSceneChange?.(null);
      // Backward seek IS this cleanup: views release what the container wipe
      // cannot reach (nothing today, boards/GL for a foreign backend).
      stage?.dispose();
      try {
        host?.dispose();
      } catch {
        /* a VM that already died on a budget interrupt cannot be disposed twice */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [js, source, speed, run]);

  const total = titles.length;
  const atEnd = total > 0 && step >= total - 1;
  const live = state !== 'failed' && total > 0;
  const canBack = live && step > 0;
  const canNext = live && !atEnd;

  /** Forward by one: the live player, no rebuild. */
  const goNext = useCallback(async () => {
    const player = playerRef.current;
    if (!player || player.atEnd) return;
    // A second navigation request interrupts the animation currently on
    // screen. Re-authoring is the safe way to cancel it: many timeline steps
    // are not reversible, while a fresh player can fast-forward to the next
    // beat with time suppressed.
    if (busyRef.current) {
      setRun((prev) => ({ id: prev.id + 1, target: step + 1, jumping: true }));
      return;
    }
    setBusyBoth(true);
    try {
      await player.next();
      setState(player.atEnd ? 'done' : 'paused');
    } catch (err) {
      setState('failed');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyBoth(false);
    }
  }, [setBusyBoth, step]);

  /**
   * Jump to a beat. Forward rides the live player's fast-forward; backward
   * bumps the effect's identity, which tears the VM down and re-authors.
   */
  const goTo = useCallback(
    async (index: number) => {
      const player = playerRef.current;
      if (index === step) return;
      if (!player || busyRef.current || index < step) {
        setBusyBoth(true);
        setState('seeking');
        setRun((prev) => ({ id: prev.id + 1, target: Math.max(0, index), jumping: true }));
        return;
      }
      setBusyBoth(true);
      try {
        await player.seek(index);
        setState(player.atEnd ? 'done' : 'paused');
      } catch (err) {
        setState('failed');
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyBoth(false);
      }
    },
    [step, setBusyBoth],
  );

  const goBack = useCallback(() => void goTo(step - 1), [goTo, step]);

  /** Left/right arrows page through the explanation — the natural gesture. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      // More than one lesson on the page: only the focused one listens.
      const root = rootRef.current;
      if (!root) return;
      if (document.querySelectorAll('.lesson').length > 1 && !root.contains(document.activeElement)) {
        return;
      }
      if (event.key === 'ArrowRight') {
        if (!canNext) return;
        event.preventDefault();
        void goNext();
      } else {
        if (!canBack) return;
        event.preventDefault();
        goBack();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canBack, canNext, goBack, goNext]);

  const title = step >= 0 ? (titles[step] ?? PROLOGUE) : undefined;
  // A beatless program is one segment: it plays through as it always did, and
  // showing it a "step 1 of 1" rail would be noise.
  const stepped = total > 1;

  return (
    <div className="lesson" ref={rootRef} tabIndex={-1}>
      {/* The controls sit ABOVE the stage on purpose. The stage's height is
          whatever the current beat draws, so anything below it walks up and
          down the page as beats grow and shrink; a header only ever gets
          pushed from below, so Back/Next/Replay stay under the cursor. */}
      <div className="lesson-head">
        <div className="lesson-head-row">
          <div className="lesson-beat" aria-live="polite">
            {stepped && (
              <span className="lesson-count">
                Step {step >= 0 ? step + 1 : '—'} of {total}
              </span>
            )}
            {stepped && title && <span className="lesson-title">{title}</span>}
            <span className="lesson-state" data-state={state}>
              {STATE_LABEL[state]}
            </span>
          </div>
          <div className="lesson-controls">
            {stepped && (
              <>
                <button
                  type="button"
                  className="lesson-step-btn"
                  onClick={goBack}
                  disabled={!canBack}
                  aria-label="Previous step"
                  title="Previous step  (←)"
                >
                  ‹ Back
                </button>
                <button
                  type="button"
                  className="lesson-step-btn lesson-step-next"
                  onClick={() => void goNext()}
                  disabled={!canNext}
                  aria-label="Next step"
                  title="Next step  (→)"
                >
                  Next ›
                </button>
              </>
            )}
            <button
              className="lesson-replay"
              disabled={busy && state !== 'failed'}
              onClick={() => setRun((prev) => ({ id: prev.id + 1, target: 0, jumping: false }))}
            >
              Replay
            </button>
          </div>
        </div>

        {stepped && (
          <ol className="lesson-rail" aria-label="Beats">
            {titles.map((t, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="lesson-tick"
                  data-done={i < step || undefined}
                  aria-current={i === step ? 'step' : undefined}
                  aria-label={`Step ${i + 1} of ${total}: ${t ?? PROLOGUE}`}
                  title={t ?? PROLOGUE}
                  disabled={busy || state === 'failed'}
                  onClick={() => void goTo(i)}
                >
                  <span className="lesson-tick-bar" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div
        className="lesson-stage"
        ref={hostRef}
        data-state={state}
        data-step={step}
        data-steps={total}
      />

      {error && (
        <p className="lesson-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
