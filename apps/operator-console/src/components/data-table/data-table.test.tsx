import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';

import { DataTable } from './data-table';
import { PreferencesProvider } from '@/components/providers/preferences-provider';
import type { SortingState } from '@tanstack/react-table';
import type { LegacyColumnDef } from '@tanstack/react-table/legacy';

interface Row {
  name: string;
  score: number;
}

const rows: Row[] = [
  { name: 'charlie', score: 3 },
  { name: 'alpha', score: 1 },
  { name: 'bravo', score: 2 },
];

const columns: LegacyColumnDef<Row, unknown>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'score', accessorKey: 'score', header: 'Score' },
];

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  const { container } = render(
    <PreferencesProvider>
      <DataTable columns={columns} data={rows} {...props} />
    </PreferencesProvider>
  );
  return container;
}

function bodyRowText(container: HTMLElement) {
  const body = container.querySelector('tbody');
  return Array.from(body?.querySelectorAll('tr') ?? []).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((td) => td.textContent)
  );
}

function headerCell(container: HTMLElement, index: number) {
  const cells = container.querySelectorAll('thead th');
  return cells[index] as HTMLElement;
}

describe('DataTable', () => {
  it('renders a row per record, in source order', () => {
    const container = renderTable();

    expect(bodyRowText(container)).toEqual([
      ['charlie', '3'],
      ['alpha', '1'],
      ['bravo', '2'],
    ]);
  });

  it('reports a sort when a header is activated, and renders the order it is given', () => {
    const seen: SortingState[] = [];
    const container = renderTable({
      state: { sorting: [], onSortingChange: (next) => seen.push(next) },
    });

    fireEvent.click(within(headerCell(container, 0)).getByRole('button'));

    expect(seen).toEqual([[{ id: 'name', desc: false }]]);

    cleanup();
    const sorted = renderTable({
      state: { sorting: [{ id: 'name', desc: false }], onSortingChange: () => {} },
    });

    expect(bodyRowText(sorted).map(([name]) => name)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('honours controlled column visibility', () => {
    const container = renderTable({
      state: { columnVisibility: { score: false }, onColumnVisibilityChange: () => {} },
    });

    expect(bodyRowText(container)).toEqual([['charlie'], ['alpha'], ['bravo']]);
  });

  it('paginates internally', () => {
    const container = renderTable({ pageSize: 2 });

    expect(bodyRowText(container)).toHaveLength(2);
  });

  it('renders the empty slot when there are no rows', () => {
    const container = renderTable({ data: [], empty: 'Nothing here' });

    expect(container.textContent).toContain('Nothing here');
  });
});
