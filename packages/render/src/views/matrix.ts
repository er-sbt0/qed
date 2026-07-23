/**
 * views/matrix.ts — matrix over cell subparts.
 *
 * Element granularity: the CELLS (the `NumericHandle`s the spec exposes,
 * usually the same objects a graph view's edges project — cell↔edge hover
 * sync is then automatic). Cell <td>s register under the cell handle ids.
 *
 * Values display from a construction-time snapshot, because playback replays
 * a program whose mutations (vary, drags) already ran: `vary` tweens the
 * display toward its recorded `to`, and `applyState()` re-reads live values
 * (used after interactive edits).
 *
 * `expose(matrix, {as: "draggable"})` enables pointer edits; the interaction
 * POLICY (renormalize-row etc.) lives inside the cell's own `setValue` — the
 * view calls it blindly and re-reads the whole matrix.
 */

import type { Handle } from '@math-ai/core';
import type { NumericHandle, VarySettable } from '@math-ai/lesson';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { fmt, displayLabel } from '../util.js';

export interface MatrixSpec {
  readonly rows: readonly Handle[];
  readonly cols: readonly Handle[];
  cellAt(row: Handle, col: Handle): NumericHandle;
  readonly title?: string;
  /** Called after an interactive edit (demo wires reactive refreshes here). */
  onEdit?(cell: NumericHandle): void;
  /**
   * Show the row/column header cells (default true). A plain numeric matrix
   * — a 2×2 linear map, say — has no state labels to head its axes; a
   * transition matrix does.
   */
  readonly headers?: boolean;
}

function canSet(cell: NumericHandle): cell is VarySettable {
  return typeof (cell as { setValue?: unknown }).setValue === 'function';
}

export class MatrixView extends View {
  private readonly cells: ReadonlyArray<readonly NumericHandle[]>;
  /** Values at construction — the state this point of the program saw. */
  private readonly initial: ReadonlyArray<readonly number[]>;
  private readonly tds = new Map<string, HTMLElement>();
  private interactive = false;

  constructor(
    stage: Stage,
    private readonly spec: MatrixSpec,
  ) {
    super(stage, 'view:matrix');
    this.cells = spec.rows.map((r) => spec.cols.map((c) => spec.cellAt(r, c)));
    this.initial = this.cells.map((row) => row.map((cell) => cell.value));
  }

  override get elements(): readonly Handle[] {
    return this.cells.flat();
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox');
    if (this.spec.title) {
      const h = doc.createElement('p');
      h.className = 'mr-view-title';
      h.textContent = this.spec.title;
      root.appendChild(h);
    }
    const table = doc.createElement('table');
    table.className = 'mr-matrix';
    root.appendChild(table);

    const headers = this.spec.headers ?? true;
    if (headers) {
      const head = doc.createElement('tr');
      head.appendChild(doc.createElement('th'));
      for (const col of this.spec.cols) {
        const th = doc.createElement('th');
        th.textContent = displayLabel(col);
        this.stage.registry.register(th, col.id);
        head.appendChild(th);
      }
      table.appendChild(head);
    }

    this.spec.rows.forEach((row, r) => {
      const tr = doc.createElement('tr');
      if (headers) {
        const th = doc.createElement('th');
        th.textContent = displayLabel(row);
        this.stage.registry.register(th, row.id);
        tr.appendChild(th);
      }
      this.spec.cols.forEach((_, c) => {
        const cell = this.cells[r]![c]!;
        const td = doc.createElement('td');
        // construction-time snapshot: playback replays a program whose
        // mutations already ran, so `vary` animates this toward its `to`
        td.textContent = fmt(this.initial[r]![c]!);
        this.stage.registry.register(td, cell.id);
        this.tds.set(cell.id, td);
        this.wireDrag(td, cell);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    return root;
  }

  override applyState(): void {
    for (const row of this.cells) {
      for (const cell of row) {
        const td = this.tds.get(cell.id);
        if (td) td.textContent = fmt(cell.value);
      }
    }
  }

  override enableInteraction(): void {
    this.interactive = true;
    this.el?.classList.add('mr-exposed');
  }

  private wireDrag(td: HTMLElement, cell: NumericHandle): void {
    td.addEventListener('pointerdown', (down: PointerEvent) => {
      if (!this.interactive || !canSet(cell)) return;
      down.preventDefault();
      td.setPointerCapture(down.pointerId);
      const start = cell.value;
      const onMove = (move: PointerEvent): void => {
        const next = Math.min(1, Math.max(0, start - (move.clientY - down.clientY) * 0.005));
        cell.setValue(next); // the object's policy keeps its invariant
        this.applyState();
        this.stage.lightUp(cell, 200);
        this.spec.onEdit?.(cell);
      };
      const onUp = (): void => {
        td.removeEventListener('pointermove', onMove);
        td.removeEventListener('pointerup', onUp);
      };
      td.addEventListener('pointermove', onMove);
      td.addEventListener('pointerup', onUp);
    });
  }
}
