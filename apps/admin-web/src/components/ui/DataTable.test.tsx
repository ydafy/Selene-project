import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DataTable, type ColumnDef } from './DataTable';

interface Row {
  name: string;
  qty: number;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'qty', header: 'Qty', enableSorting: false },
];

const rows: Row[] = [
  { name: 'Charlie', qty: 3 },
  { name: 'Alpha', qty: 1 },
  { name: 'Bravo', qty: 2 },
];

function html(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return renderToStaticMarkup(
    <DataTable columns={columns} data={rows} {...props} />,
  );
}

function names(markup: string) {
  return ['Alpha', 'Bravo', 'Charlie'].sort(
    (a, b) => markup.indexOf(a) - markup.indexOf(b),
  );
}

it('renders rows in data order when unsorted', () => {
  expect(names(html())).toEqual(['Charlie', 'Alpha', 'Bravo']);
});

it('sorts client-side ascending and descending from the sorting state', () => {
  expect(names(html({ sorting: [{ id: 'name', desc: false }] }))).toEqual([
    'Alpha',
    'Bravo',
    'Charlie',
  ]);
  expect(names(html({ sorting: [{ id: 'name', desc: true }] }))).toEqual([
    'Charlie',
    'Bravo',
    'Alpha',
  ]);
});

it('renders a sort button only for sortable columns', () => {
  const markup = html();
  expect(markup).toContain('aria-label="Sort by Name"');
  expect(markup).not.toContain('aria-label="Sort by Qty"');
  expect(html({ enableSorting: false })).not.toContain('Sort by');
});

it('does not sort in the table when sorting is handled by the caller', () => {
  const markup = html({
    sorting: [{ id: 'name', desc: false }],
    onSortingChange: () => {},
  });
  expect(names(markup)).toEqual(['Charlie', 'Alpha', 'Bravo']);
});

it('paginates client-side by the pagination state', () => {
  const markup = html({ pagination: { pageIndex: 1, pageSize: 2 } });
  expect(markup).toContain('Bravo');
  expect(markup).not.toContain('Charlie');
  expect(markup).not.toContain('Alpha');
  expect(markup).toContain('Mostrando página 2 de 2');
  expect(markup).toContain('aria-label="Previous page"');
});

it('hides the pagination footer when everything fits on one page', () => {
  expect(html()).not.toContain('Mostrando página');
});

it('shows every row and the caller page count with manual pagination', () => {
  const markup = html({
    pageCount: 5,
    pagination: { pageIndex: 0, pageSize: 2 },
  });
  expect(names(markup)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  expect(markup).toContain('Mostrando página 1 de 5');
  expect(markup).toMatch(
    /disabled=""[^>]*aria-label="Previous page"|aria-label="Previous page"[^>]*disabled=""/,
  );
});

it('renders the empty message when there is no data', () => {
  expect(html({ data: [], emptyMessage: 'Nothing here' })).toContain(
    'Nothing here',
  );
});

it('renders skeleton rows instead of data while loading', () => {
  const markup = html({ isLoading: true, skeletonRowCount: 2 });
  expect(markup).not.toContain('Alpha');
  expect(markup.match(/<tr aria-hidden="true">/g)).toHaveLength(2);
});
