/**
 * animate.ts — browser animation primitives over the Web Animations API,
 * with graceful no-ops when WAAPI is unavailable. All durations arrive
 * already speed-scaled from the player.
 *
 * ZERO DURATION IS THE INSTANT CONTRACT. `ms <= 0` means "land in the final
 * state now, settle the promise now" — every primitive here short-circuits
 * before touching WAAPI or requestAnimationFrame. That is what makes the
 * player's fast-forward (seeking to a beat by silently replaying the ones
 * before it) both correct and prompt:
 *
 *   · correct — each primitive's *effect* is the class/style/text change it
 *     makes around the animation (enter removes `mr-hidden`, exit adds it,
 *     tweenNumber writes the value), and the keyframes always END at the
 *     element's natural state. Skipping the interpolation therefore leaves
 *     exactly the state the animation would have left.
 *   · prompt — WAAPI's `finished` promise and rAF only tick while the
 *     document is rendering. A 0ms animation still costs a frame, and a
 *     backgrounded tab can stall one indefinitely; a fast-forward over
 *     hundreds of steps must not depend on that.
 */

export function animate(
  el: Element,
  keyframes: Keyframe[],
  ms: number,
  easing = 'ease',
): Promise<void> {
  if (!(ms > 0)) return Promise.resolve(); // instant: the final state is the natural one
  const anim = (el as HTMLElement).animate?.(keyframes, { duration: ms, easing });
  if (!anim) return Promise.resolve();
  return anim.finished.then(
    () => undefined,
    () => undefined,
  );
}

export function pulse(el: Element, ms = 500): Promise<void> {
  return animate(
    el,
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.18)', offset: 0.4 },
      { transform: 'scale(1)' },
    ],
    ms,
  );
}

export async function enter(el: HTMLElement, from: 'top' | 'left' | 'fade' | undefined, ms: number): Promise<void> {
  el.classList.remove('mr-hidden');
  const start =
    from === 'top'
      ? { transform: 'translateY(-26px)', opacity: 0 }
      : from === 'left'
        ? { transform: 'translateX(-26px)', opacity: 0 }
        : { transform: 'none', opacity: 0 };
  await animate(el, [start, { transform: 'none', opacity: 1 }], ms, 'ease-out');
}

export async function exit(el: HTMLElement, ms: number): Promise<void> {
  await animate(el, [{ opacity: 1 }, { opacity: 0 }], ms, 'ease-in');
  el.classList.add('mr-hidden');
}

function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export interface TravelOpts {
  readonly ms: number;
  /** Clone the source node as the traveler (default: a dot). */
  readonly clone?: Element;
  /** Dot diameter in px (when not cloning). */
  readonly size?: number;
  readonly ambient?: boolean;
}

/**
 * Fly a traveler from one element's center to another's. The traveler is a
 * fixed-position element in the document body, so registry nodes from any
 * view can be endpoints.
 */
export async function travel(doc: Document, fromEl: Element, toEl: Element, opts: TravelOpts): Promise<void> {
  // instant: a traveler is pure motion — it leaves nothing behind, so there is
  // nothing to apply. Never mint the node at all (it would flash and linger).
  if (!(opts.ms > 0)) return;
  const a = centerOf(fromEl);
  const b = centerOf(toEl);
  let traveler: HTMLElement;
  if (opts.clone) {
    traveler = opts.clone.cloneNode(true) as HTMLElement;
    traveler.classList.remove('mr-hidden', 'mr-prehidden', 'mr-lit');
    const r = opts.clone.getBoundingClientRect();
    traveler.style.width = `${r.width}px`;
    traveler.style.height = `${r.height}px`;
    traveler.style.left = `${r.left}px`;
    traveler.style.top = `${r.top}px`;
  } else {
    const size = opts.size ?? 12;
    traveler = doc.createElement('div');
    traveler.className = `mr-dot${opts.ambient ? ' mr-dot-ambient' : ''}`;
    traveler.style.width = `${size}px`;
    traveler.style.height = `${size}px`;
    traveler.style.left = `${a.x - size / 2}px`;
    traveler.style.top = `${a.y - size / 2}px`;
  }
  traveler.classList.add('mr-traveler');
  doc.body.appendChild(traveler);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  try {
    await animate(
      traveler,
      [
        { transform: 'translate(0, 0)', opacity: 0.2 },
        { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.9 },
      ],
      opts.ms,
      'cubic-bezier(0.4, 0, 0.2, 1)',
    );
  } finally {
    traveler.remove();
  }
}

/** Tween a numeric text node from→to, calling `write` each frame. */
export function tweenNumber(
  from: number,
  to: number,
  ms: number,
  write: (value: number) => void,
): Promise<void> {
  if (!(ms > 0)) {
    write(to); // instant: the tween's whole effect is its last frame
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now: number): void => {
      const t = Math.min((now - t0) / ms, 1);
      const eased = t * (2 - t); // ease-out
      write(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function wait(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Two animation frames — layout settled after a mount. */
export function settled(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
