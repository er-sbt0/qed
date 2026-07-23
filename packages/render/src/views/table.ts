/**
 * views/table.ts — the generic table: header cells are HANDLES (the same
 * objects that live elsewhere in the scene — F5's identity law), body cells
 * hold verdicts, handles, or plain text.
 *
 * Element granularity: the HEADER handles are the elements — a table projects
 * its subjects, and a morph out of a table sends those subjects to their
 * counterparts. Cells and rows/columns are addressable SUBPARTS (`table:row`,
 * `table:col`, `table:cell` handles) used by `buildUp` reveal groups, not
 * morph elements.
 *
 * BuildUpSubject: `buildUpGroups(order)` returns reveal groups per traversal.
 * Each group leads with the axis header's own handle (so revealing a column
 * lights everything that corresponds to that header — linked formula spans
 * included), then the axis subpart, then the cells.
 */

import type { Handle } from '@math-ai/core';
import type { BuildUpOrder, Verdict } from '@math-ai/lesson';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { displayLabel } from '../util.js';

export type CellContent = string | number | Verdict | Handle;

export interface TableSpec<Rh extends Handle = Handle, Ch extends Handle = Handle> {
  readonly rowHeaders: readonly Rh[];
  readonly colHeaders: readonly Ch[];
  cell(row: Rh, col: Ch): CellContent;
  readonly title?: string;
}

function isVerdict(x: CellContent): x is Verdict {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as Verdict).label === 'string' &&
    typeof (x as Verdict).polarity === 'string'
  );
}

function isHandleContent(x: CellContent): x is Handle {
  return typeof x === 'object' && x !== null && 'id' in x && 'kind' in x && !('polarity' in x);
}

export class TableView<Rh extends Handle = Handle, Ch extends Handle = Handle> extends View {
  readonly rowHandles: readonly Handle<'table:row'>[];
  readonly colHandles: readonly Handle<'table:col'>[];
  /** row-major */
  readonly cellHandles: ReadonlyArray<readonly Handle<'table:cell'>[]>;

  constructor(
    stage: Stage,
    private readonly spec: TableSpec<Rh, Ch>,
  ) {
    super(stage, 'view:table');
    this.rowHandles = spec.rowHeaders.map(() => stage.world.handle('table:row'));
    this.colHandles = spec.colHeaders.map(() => stage.world.handle('table:col'));
    this.cellHandles = spec.rowHeaders.map(() =>
      spec.colHeaders.map(() => stage.world.handle('table:cell')),
    );
  }

  /** Subpart addressing by header handle, never by index (F5). */
  row(header: Handle): Handle<'table:row'> {
    const i = this.spec.rowHeaders.findIndex((h) => h.id === header.id);
    if (i < 0) throw new Error(`table ${this.id}: no row headed by ${header.id}`);
    return this.rowHandles[i]!;
  }

  col(header: Handle): Handle<'table:col'> {
    const i = this.spec.colHeaders.findIndex((h) => h.id === header.id);
    if (i < 0) throw new Error(`table ${this.id}: no column headed by ${header.id}`);
    return this.colHandles[i]!;
  }

  override get elements(): readonly Handle[] {
    return [...this.spec.rowHeaders, ...this.spec.colHeaders];
  }

  buildUpGroups(order: BuildUpOrder): ReadonlyArray<readonly Handle[]> {
    if (order === 'row-by-row') {
      return this.spec.rowHeaders.map((header, r) => [
        header,
        this.rowHandles[r]!,
        ...this.cellHandles[r]!,
      ]);
    }
    if (order === 'column-by-column') {
      return this.spec.colHeaders.map((header, c) => [
        header,
        this.colHandles[c]!,
        ...this.cellHandles.map((row) => row[c]!),
      ]);
    }
    // cell-by-cell, row-major
    return this.cellHandles.flatMap((row) => row.map((cell) => [cell]));
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
    table.className = 'mr-table';
    root.appendChild(table);

    const head = doc.createElement('tr');
    head.appendChild(doc.createElement('th')); // corner
    this.spec.colHeaders.forEach((header, c) => {
      const th = doc.createElement('th');
      th.textContent = displayLabel(header);
      // the header cell IS a mention of the header object + the column subpart
      this.stage.registry.register(th, header.id, this.colHandles[c]!.id);
      head.appendChild(th);
    });
    table.appendChild(head);

    this.spec.rowHeaders.forEach((rowHeader, r) => {
      const tr = doc.createElement('tr');
      const th = doc.createElement('th');
      th.textContent = displayLabel(rowHeader);
      this.stage.registry.register(th, rowHeader.id, this.rowHandles[r]!.id);
      tr.appendChild(th);
      this.spec.colHeaders.forEach((colHeader, c) => {
        const td = doc.createElement('td');
        this.renderCell(doc, td, this.spec.cell(rowHeader, colHeader));
        this.stage.registry.register(td, this.cellHandles[r]![c]!.id);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    return root;
  }

  private renderCell(doc: Document, td: HTMLElement, content: CellContent): void {
    if (isVerdict(content)) {
      const badge = doc.createElement('span');
      badge.className = `mr-verdict mr-verdict-${content.polarity}`;
      badge.textContent = content.label;
      td.appendChild(badge);
    } else if (isHandleContent(content)) {
      const chip = doc.createElement('span');
      chip.className = 'mr-token';
      chip.textContent = displayLabel(content);
      this.stage.registry.register(chip, content.id);
      td.appendChild(chip);
    } else {
      td.textContent = String(content);
    }
  }
}
