/**
 * views/experiment.ts — side-by-side (or stacked) subjects with verdict
 * badges. The player auto-creates one when it executes a `compareExperiment`
 * step; the payload carries everything (experiment value, subjects, layout).
 *
 * Element granularity: the SUBJECTS are the elements. Registry keys beyond
 * the subject/result ids:
 *   `${experiment.id}#side<i>`     the whole outcome panel (compare:apply cues)
 *   `${experiment.id}#verdict<i>`  the verdict badge (compare:judge cues)
 *
 * Agreement emphasis is typed, not parsed: polarity classes color the badges,
 * and the banner styles by the experiment's `agreement`.
 */

import type { Handle } from '@math-ai/core';
import type { CompareExperimentPayload } from '@math-ai/lesson';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { displayLabel } from '../util.js';

export class ExperimentView extends View {
  constructor(
    stage: Stage,
    private readonly payload: CompareExperimentPayload,
  ) {
    super(stage, 'view:experiment');
  }

  override get elements(): readonly Handle[] {
    return this.payload.subjects;
  }

  protected render(doc: Document): HTMLElement {
    const { experiment } = this.payload;
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox', 'mr-experiment');
    if (this.payload.layout === 'stacked') root.classList.add('mr-stacked');
    this.stage.registry.register(root, experiment.id);

    const row = doc.createElement('div');
    row.className = 'mr-experiment-row';
    experiment.outcomes.forEach((outcome, i) => {
      const panel = doc.createElement('div');
      panel.className = 'mr-outcome';
      this.stage.registry.register(panel, `${experiment.id}#side${i}`);

      const subject = doc.createElement('span');
      subject.className = 'mr-token';
      subject.textContent = displayLabel(outcome.subject);
      this.stage.registry.register(subject, outcome.subject.id);

      const arrow = doc.createElement('span');
      arrow.className = 'mr-outcome-arrow';
      arrow.textContent = '→';

      const result = doc.createElement('span');
      result.className = 'mr-token';
      result.textContent = displayLabel(outcome.result);
      this.stage.registry.register(result, outcome.result.id);

      const badge = doc.createElement('span');
      badge.className = `mr-verdict mr-verdict-${outcome.verdict.polarity}`;
      badge.textContent = outcome.verdict.label;
      this.stage.registry.register(badge, `${experiment.id}#verdict${i}`);

      panel.append(subject, arrow, result, badge);
      row.appendChild(panel);
    });
    root.appendChild(row);

    const banner = doc.createElement('div');
    banner.className = `mr-agreement mr-agreement-${experiment.agreement}`;
    banner.textContent = experiment.agreement === 'distinguished' ? 'DISTINGUISHED' : 'AGREE';
    root.appendChild(banner);

    return root;
  }
}
