/**
 * views/narration.ts — the narration panel. Narration is a view (spike F6):
 * interpolated handles become live, linked mentions — each mention chip
 * registers under the mentioned object's id, so focusing/animating the object
 * lights its mentions, and hovering a mention lights the object everywhere.
 */

import { isHandle } from '@math-ai/core';
import type { SayPayload } from '@math-ai/lesson';
import type { Stage } from '../stage.js';
import { displayLabel } from '../util.js';
import { renderTex } from '../tex.js';

/** Append one say-step to the stage's narration panel. */
export function appendNarration(stage: Stage, payload: SayPayload): HTMLElement | null {
  const host = stage.narrationEl;
  const doc = stage.doc;
  if (!host || !doc) return null;
  const p = doc.createElement('p');
  payload.strings.forEach((s, i) => {
    if (s) p.appendChild(doc.createTextNode(s));
    const mention = payload.mentions[i];
    if (mention === undefined) return;
    if (isHandle(mention)) {
      const chip = doc.createElement('span');
      chip.className = 'mr-mention';
      // labels are authored as TeX (`\Delta x`, `\det A`) — typeset them
      renderTex(chip, displayLabel(mention));
      stage.registry.register(chip, mention.id);
      chip.addEventListener('mouseenter', () => stage.lightUp(mention));
      p.appendChild(chip);
    } else {
      p.appendChild(doc.createTextNode(String(mention)));
    }
  });
  for (const prev of host.querySelectorAll('p.mr-current')) prev.classList.remove('mr-current');
  p.classList.add('mr-current');
  host.appendChild(p);
  host.scrollTop = host.scrollHeight;
  return p;
}
