import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectionActionSummary } from './SelectionActionSummary';

it('shares a content-sized surface with prominent amount and configurable actions', () => {
  const html = renderToStaticMarkup(
    <SelectionActionSummary
      label="Retry selection"
      title="Total to retry"
      amountLabel="Selected retry amount"
      amount="$125"
      unit="MXN"
      selection="1 selected"
      description="Does not prove bank receipt."
    >
      <button type="button">Retry</button>
    </SelectionActionSummary>,
  );
  expect(html).toContain('aria-label="Retry selection"');
  expect(html).toContain('w-fit');
  expect(html).toContain('max-w-full');
  expect(html).toContain('text-3xl font-bold tabular-nums');
  expect(html).toContain('$125');
  expect(html).toContain('MXN');
  expect(html).toContain('1 selected');
  expect(html).toContain('Does not prove bank receipt.');
  expect(html).toContain('Retry</button>');
});
