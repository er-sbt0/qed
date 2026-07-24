# Probe 1 — the coordinate rack on a signals + frame + kernel stage

**Target:** re-create Tychonoff scene I (the baseline `t1-the-rack.html`) on a hand-built
stage that exercises the proposed architecture, and make the pedagogy *genuinely reactive*
instead of hand-wired. File: `rack-probe.html` (self-contained, opens in any browser).

**Verdict: the architecture holds.** The figure matches the baseline's aesthetic, and the
four load-bearing pieces each carried their weight with less code than the baseline spends
on the same figure.

## What was proven

| Proposal piece | How the probe tests it | Result |
| --- | --- | --- |
| **Open kernel, named frame — no pixels** | Author code says `F.colX(k)`, `F.colW(k)`; all recede/fit math lives in one `recedeFrame({x0,width,n,ratio})`. | ✅ Not one pixel constant in the figure body. Swapping `ratio` or `n` reflows everything for free. |
| **Reactive signals graph (qed's `Live<T>` ported)** | `signal / derived / effect` in ~40 lines. State = 4 signals (`mode/base/pins/pts`). | ✅ Handlers only *set* signals. There is exactly **one** `effect` that repaints. |
| **Reactive claim (qed's `M.claim`)** | `clampedCount = derived(...)`, `membership = claim(...)` re-judge on read. | ✅ Box-mode flip re-derived count → ∞ and verdict → "no finite subcover" with zero repaint wiring. |
| **Renderer-agnostic mark kernel** | Figure emits abstract ops (`rect/text/line/circle`); `paint()` serializes to SVG. | ✅ A WebGL backend (probe 2) consumes the *same* ops. The figure code is backend-blind. |

## The headline contrast with the baseline

- **Baseline:** every interaction handler ends in a manual `render()`. State lives in a bare
  `st` object; correctness depends on never forgetting to repaint.
- **Probe:** handlers set a signal and stop. Repaint and re-derivation are automatic. The count
  and the membership verdict *cannot* fall out of sync with the state — they are the state,
  read through `derived`. This is exactly qed's reactivity thesis, and it survived the port
  onto a from-scratch drawing surface intact.

## New capability over the baseline

The **scrubber rail** is a continuous drag (`base` signal) that slides the window out to
coordinate 10,000. The baseline did this as a binary jump because a hand-wired repaint made
continuous motion awkward. Here it's free — drag → `base.value = n` → the whole scene
re-derives per frame. This is the "claim that moves under a drag" idiom, and it came for
nothing once the signals graph existed.

## Friction ledger (feeds the LLM-surface design)

1. **The frame wants a vertical partner.** `recedeFrame` owns x beautifully; the two value
   rows (`Y1/Y0/CH`) are still loose constants. Real design needs `frame.band([...])` or a
   2-axis frame so the author never touches `Y1` either. *Cheap, do it.*
2. **The mark kernel is too low (rect/text/line).** The figure re-derives "a clamped cell",
   "a point marker", "a strip" inline every column. Those are the first **idioms** — the
   composed layer the LLM should reach for (`rackColumn`, `pointMarker`). Confirms the
   open-kernel-plus-idiom-library shape directly: I built the kernel and immediately wanted
   the idioms on top.
3. **`derived` is eager and re-runs fully.** Fine at this scale; a real stage needs memoized
   derivations + batched flush (microtask) before fields/heatmaps with grid² reads.
4. **SVG was the right call for *this* figure.** A 2D combinatorial rack does not want WebGL.
   The kernel stayed backend-agnostic so probe 2 (a genuinely 3D topology moment) can route
   the same ops to Three.js and prove the ceiling — that's where WebGL earns its place, not
   here.
5. **No coordinate authoring leaked in.** The strongest signal for the LLM story: the whole
   figure is written in *semantic* terms (column index, value 0/1, clamp state) mapped through
   the frame. This is the property visual.md refuses to give up, and the open kernel kept it.

## What this does *not* yet answer

- **Composition/layout** (the Penrose question) — untested; this is a single figure, not a
  multi-panel scene that must allocate space from declared roles. That's a separate probe.
- **The 3D ceiling** — untested here by design; probe 2.
- **LLM authorability** — deliberately deferred. We build the substrate, feel its ergonomics,
  *then* design what the model writes. This probe says the substrate is sound.
