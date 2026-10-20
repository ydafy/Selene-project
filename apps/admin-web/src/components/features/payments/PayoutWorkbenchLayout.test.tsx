import { afterEach, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PAYOUT_PAGE_SIZE,
  PayoutPagination,
  workbenchGrid,
  workbenchPanel,
  workbenchScroll,
} from './PayoutWorkbenchLayout';

afterEach(() => mock.restore());

it('keeps two equal desktop panels and independently bounded scroll bodies', () => {
  expect(workbenchGrid).toContain('lg:grid-cols-2');
  expect(workbenchPanel).toContain('lg:h-[min(65vh,640px)]');
  expect(workbenchPanel).toContain('min-h-0');
  expect(workbenchScroll).toContain('overflow-y-auto');
  expect(workbenchScroll).toContain('min-h-0');
  expect(PAYOUT_PAGE_SIZE).toBe(20);
});

it('shows queried-result pagination rather than implying server paging', () => {
  const html = renderToStaticMarkup(
    <PayoutPagination
      page={0}
      total={101}
      label="vendedores"
      onPageChange={() => undefined}
    />,
  );
  expect(html).toContain('1–20 de 101');
  expect(html).toContain('aria-label="Paginación de vendedores"');
  expect(html).toContain(
    'aria-label="Página anterior de vendedores" disabled=""',
  );
  expect(html).not.toContain('Página siguiente de vendedores" disabled');
});

it('optionally shows current page and page count without changing the default row range', () => {
  for (const [page, total, expected] of [
    [0, 7, 'Página 1 de 1'],
    [1, 25, 'Página 2 de 2'],
    [9, 25, 'Página 2 de 2'],
    [0, 0, 'Página 1 de 1'],
  ] as const) {
    const html = renderToStaticMarkup(
      <PayoutPagination
        page={page}
        total={total}
        label="vendedores"
        display="pages"
        onPageChange={() => undefined}
      />,
    );
    expect(html).toContain(expected);
    expect(html).not.toContain('–');
  }
});
it('clamps an obsolete page and exposes no navigation past the last result', () => {
  const changes: number[] = [];
  const el = PayoutPagination({
    page: 5,
    total: 21,
    label: 'ejecuciones',
    onPageChange: (page) => changes.push(page),
  });
  const children = el.props.children;
  const buttons = children[1].props.children;
  expect(buttons[1].props.disabled).toBe(true);
  buttons[1].props.onClick();
  expect(changes).toEqual([]);
  buttons[0].props.onClick();
  expect(changes).toEqual([0]);
  expect(renderToStaticMarkup(el)).toContain('21–21 de 21');
});

it('disables public paging controls while financial execution is busy', () => {
  const changes: number[] = [];
  const el = PayoutPagination({
    page: 1,
    total: 100,
    label: 'vendedores',
    disabled: true,
    onPageChange: (page) => changes.push(page),
  });
  const buttons = el.props.children[1].props.children;
  for (const button of buttons) {
    expect(button.props.disabled).toBe(true);
    button.props.onClick();
  }
  expect(changes).toEqual([]);
});
