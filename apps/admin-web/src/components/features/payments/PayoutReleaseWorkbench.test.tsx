import { SelectionActionSummary } from '../../ui/SelectionActionSummary';
import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayoutReleaseWorkbench } from './PayoutReleaseWorkbench';
import type { ReleaseQueueBatch } from '../../../lib/connectPayoutReleaseQueue';

const batch: ReleaseQueueBatch = {
  sellerId: 'seller-a',
  sellerName: 'Aurora',
  stripeAccountId: 'acct_a',
  totalEligibleAmountCents: 12500,
  eligibleShipmentCount: 1,
  ineligibleShipmentCount: 1,
  releaseState: 'partial',
  shipments: [
    {
      shipmentId: 'shipment-ready',
      orderId: 'order-a',
      completedAt: '2026-10-01T12:00:00Z',
      isEligible: true,
      ineligibleReason: null,
      releaseAmountCents: 12500,
      reconciliationIndicator: 'ready_for_release',
      status: 'completed',
      stripePaymentIntentId: 'pi_a',
    },
    {
      shipmentId: 'shipment-blocked',
      orderId: 'order-b',
      completedAt: null,
      isEligible: false,
      ineligibleReason: 'SHIPMENT_NOT_COMPLETED',
      releaseAmountCents: 90000,
      reconciliationIndicator: 'blocked',
      status: 'delivered',
      stripePaymentIntentId: 'pi_b',
    },
  ],
};

type Element = React.ReactElement<Record<string, unknown>>;
function nodes(value: React.ReactNode): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  if (value.type === SelectionActionSummary)
    return nodes(
      SelectionActionSummary(
        value.props as unknown as Parameters<typeof SelectionActionSummary>[0],
      ),
    );
  return [value, ...nodes(value.props.children as React.ReactNode)];
}
function label(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(label).join('');
  return React.isValidElement<Record<string, unknown>>(value)
    ? label(value.props.children as React.ReactNode)
    : '';
}
function harness(overrides: Record<string, unknown> = {}) {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const layoutEffects: (() => void)[] = [];
  spyOn(React, 'useLayoutEffect').mockImplementation((effect) => {
    layoutEffects.push(() => {
      effect();
    });
  });
  let stateIndex = 0;
  let refIndex = 0;
  spyOn(React, 'useState').mockImplementation(((initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (next: unknown) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
      },
    ];
  }) as typeof React.useState);
  spyOn(React, 'useRef').mockImplementation(((initial: unknown) => {
    const index = refIndex++;
    refs[index] ??= { current: initial };
    return refs[index];
  }) as typeof React.useRef);
  const calls: string[] = [];
  const props = {
    batches: [batch],
    isLoading: false,
    isReleasing: false,
    selectedShipmentsBySeller: {
      'seller-a': ['shipment-ready', 'shipment-blocked', 'stale'],
    },
    onToggleShipment: () => undefined,
    onSelectEligibleBatch: () => undefined,
    onSelectAllEligibleGlobally: () => undefined,
    onClearAllSelections: () => undefined,
    onRelease: async (sellerId: string) => {
      calls.push(sellerId);
    },
    ...overrides,
  };
  const render = (commit = true) => {
    stateIndex = 0;
    refIndex = 0;
    layoutEffects.length = 0;
    const tree = PayoutReleaseWorkbench(props);
    // Direct public-control probes flush layout work only after render returns.
    if (commit) layoutEffects.splice(0).forEach((effect) => effect());
    return tree;
  };
  const click = async (text: string) => {
    const button = nodes(render()).find(
      (node) =>
        node.type === 'button' &&
        label(node.props.children as React.ReactNode) === text,
    );
    expect(button, `Missing public button: ${text}`).toBeDefined();
    expect(button!.props.disabled).not.toBe(true);
    await (button!.props.onClick as () => unknown)();
  };
  const openDetail = () => {
    const button = nodes(render()).find(
      (n) =>
        n.type === 'button' &&
        String(n.props['aria-label']).startsWith('Ver detalle de '),
    )!;
    expect(button).toBeDefined();
    expect(button.props.disabled).not.toBe(true);
    (button.props.onClick as () => void)();
  };
  return { render, click, calls, props, openDetail };
}
// Restore spies after each example; no client modules or financial requests are loaded.
afterEach(() => mock.restore());

it('renders SSR with native hooks without dispatching financial callbacks', () => {
  let calls = 0;
  const html = renderToStaticMarkup(
    <PayoutReleaseWorkbench
      batches={[batch]}
      isLoading={false}
      isReleasing={false}
      selectedShipmentsBySeller={{ 'seller-a': ['shipment-ready'] }}
      onToggleShipment={() => undefined}
      onSelectEligibleBatch={() => undefined}
      onClearAllSelections={() => undefined}
      onRelease={async () => {
        calls++;
      }}
    />,
  );
  expect(html).toContain('Liberar');
  expect(html).not.toContain('Confirmar liberación');
  expect(calls).toBe(0);
});
it('fits the batch action surface to content without exceeding available width', () => {
  const h = harness();
  const summary = nodes(h.render()).find(
    (n) => n.props['aria-label'] === 'Selección para liberar',
  );
  expect(summary).toBeDefined();
  expect(summary!.props.className).toContain('w-fit');
  expect(summary!.props.className).toContain('max-w-full');
});
it('emphasizes the selected eligible amount separately from selection counts', () => {
  const h = harness();
  const amount = nodes(h.render()).find(
    (n) => n.props['aria-label'] === 'Importe seleccionado para liberar',
  );
  expect(amount).toBeDefined();
  expect(label(amount!.props.children as React.ReactNode)).toContain('125');
  expect(label(amount!.props.children as React.ReactNode)).not.toContain('900');
  expect(amount!.props.className).toContain('text-3xl');
  expect(amount!.props.className).toContain('font-bold');
  expect(amount!.props.className).toContain('tabular-nums');
});
it('explains that release initiates sending rather than proving bank receipt', () => {
  const html = renderToStaticMarkup(harness().render());
  expect(html).toContain(
    'Liberar inicia el envío del dinero al banco del vendedor; no confirma que ya haya llegado a su cuenta.',
  );
  expect(html).not.toContain(
    'Solo resultados consultados, incluidas otras páginas visuales.',
  );
});
it('labels the first action Liberar without bypassing explicit confirmation', async () => {
  const h = harness();
  await h.click('Liberar');
  expect(h.calls).toEqual([]);
  expect(renderToStaticMarkup(h.render())).toContain('Confirmar liberación');
  await h.click('Confirmar liberación');
  expect(h.calls).toEqual(['seller-a']);
});
it('opens seller details without selecting or releasing and closes without losing selection', async () => {
  const selected: unknown[] = [];
  const h = harness({
    onSelectEligibleBatch: (...args: unknown[]) => selected.push(args),
  });
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Detalle de liberación',
  );
  const card = nodes(h.render()).find(
    (n) => n.props['aria-label'] === 'Ver detalle de Aurora',
  )!;
  expect(card).toBeDefined();
  await (card.props.onClick as () => void)();
  const tree = h.render();
  const modal = nodes(tree).find(
    (n) => n.props.title === 'Revisión por vendedor',
  );
  expect(modal).toBeDefined();
  expect(renderToStaticMarkup(tree)).toContain('acct_a');
  expect(renderToStaticMarkup(tree)).toContain('shipment-blocked');
  expect(selected).toEqual([]);
  expect(h.calls).toEqual([]);
  (modal!.props.onClose as () => void)();
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Detalle de liberación',
  );
  expect(h.props.selectedShipmentsBySeller['seller-a']).toContain(
    'shipment-ready',
  );
});
it('marks only actual eligible selections green with a trailing check and partial counts', () => {
  const h = harness({ selectedShipmentsBySeller: {} });
  let card = nodes(h.render()).find(
    (n) => n.props['aria-label'] === 'Ver detalle de Aurora',
  )!;
  expect(card).toBeDefined();
  expect(card.props.className).not.toContain('bg-forest/');
  expect(label(card.props.children as React.ReactNode)).not.toContain(
    'seleccionados',
  );
  h.props.batches = [
    {
      ...batch,
      shipments: [
        ...batch.shipments,
        { ...batch.shipments[0], shipmentId: 'ready-2' },
      ],
    },
  ];
  h.props.selectedShipmentsBySeller = {
    'seller-a': ['shipment-ready', 'shipment-blocked', 'stale'],
  };
  card = nodes(h.render()).find(
    (n) => n.props['aria-label'] === 'Ver detalle de Aurora',
  )!;
  expect(card.props.className).toContain('border-l-forest');
  expect(card.props.className).toContain('bg-forest/');
  expect(label(card.props.children as React.ReactNode)).toContain(
    '1 de 2 seleccionados',
  );
  expect(
    nodes(card).some((n) => n.props['aria-label'] === 'Selección parcial'),
  ).toBe(true);
  h.props.selectedShipmentsBySeller = {
    'seller-a': ['shipment-blocked', 'stale'],
  };
  card = nodes(h.render()).find(
    (n) => n.props['aria-label'] === 'Ver detalle de Aurora',
  )!;
  expect(card.props.className).not.toContain('bg-forest/');
});
it('uses taller seller rows with page scroll rather than a bounded two-panel list', () => {
  const h = harness();
  const list = nodes(h.render()).find(
    (n) => n.props['aria-label'] === 'Vendedores por liberar',
  )!;
  expect(list.props.className).not.toContain('lg:h-');
  expect(renderToStaticMarkup(list)).not.toContain('overflow-y-auto');
  const card = nodes(list).find(
    (n) => n.props['aria-label'] === 'Ver detalle de Aurora',
  )!;
  expect(card).toBeDefined();
  expect(card.props.className).toContain('py-7');
  expect(renderToStaticMarkup(h.render())).not.toContain('lg:grid-cols-2');
});
it('seller navigation requests page-number presentation and retains twenty-row visual pages', () => {
  const h = harness({
    batches: Array.from({ length: 25 }, (_, i) => ({
      ...batch,
      sellerId: `seller-${i}`,
    })),
  });
  const pagination = nodes(h.render()).find(
    (n) => n.props.label === 'vendedores',
  )!;
  expect(pagination.props.display).toBe('pages');
  expect(
    nodes(h.render()).filter((n) =>
      String(n.props['aria-label']).startsWith('Ver detalle de '),
    ),
  ).toHaveLength(20);
  (pagination.props.onPageChange as (page: number) => void)(1);
  expect(
    nodes(h.render()).filter((n) =>
      String(n.props['aria-label']).startsWith('Ver detalle de '),
    ),
  ).toHaveLength(5);
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Detalle de liberación',
  );
});
it('clears only the focused seller from the inspector and keeps global clear separate', async () => {
  const selections: unknown[] = [];
  let globalClears = 0;
  const h = harness({
    batches: [batch, { ...batch, sellerId: 'seller-b' }],
    onSelectEligibleBatch: (...args: unknown[]) => selections.push(args),
    onClearAllSelections: () => {
      globalClears++;
    },
  });
  h.openDetail();
  const inspector = nodes(h.render()).find(
    (node) => node.props['aria-label'] === 'Detalle de liberación',
  )!;
  const clear = nodes(inspector).find(
    (node) =>
      node.type === 'button' &&
      label(node.props.children as React.ReactNode).startsWith(
        'Limpiar selección',
      ),
  )!;
  await (clear.props.onClick as () => unknown)();
  expect(selections).toEqual([['seller-a', []]]);
  expect(globalClears).toBe(0);
  await h.click('Limpiar selección');
  expect(globalClears).toBe(1);
});
it('ignores uncommitted refreshed authority during serial dispatch', async () => {
  const calls: string[] = [];
  const second = { ...batch, sellerId: 'seller-b' };
  const h = harness({
    batches: [batch, second],
    selectedShipmentsBySeller: {
      'seller-a': ['shipment-ready'],
      'seller-b': ['shipment-ready'],
    },
    onRelease: async (id: string) => {
      calls.push(id);
      if (id === 'seller-a') {
        h.props.batches = [
          batch,
          { ...second, stripeAccountId: 'uncommitted' },
        ];
        h.render(false);
      }
    },
  });
  await h.click('Liberar');
  await h.click('Confirmar liberación');
  expect(calls).toEqual(['seller-a', 'seller-b']);
});
it('selects eligible positive shipments across queried sellers and separates seller selection from focus', async () => {
  const selections: unknown[] = [];
  const other = { ...batch, sellerId: 'seller-b', stripeAccountId: 'acct_b' };
  const h = harness({
    batches: [batch, other],
    onSelectEligibleBatch: (...args: unknown[]) => selections.push(args),
  });
  await h.click('Seleccionar todos los elegibles');
  expect(selections).toEqual([
    ['seller-a', ['shipment-ready']],
    ['seller-b', ['shipment-ready']],
  ]);
  expect(
    nodes(h.render()).filter(
      (n) =>
        n.type === 'button' &&
        String(n.props['aria-label']).startsWith('Ver detalle de '),
    ).length,
  ).toBe(2);
});
it('renders only twenty seller rows without a two-panel grid', () => {
  const h = harness({
    batches: Array.from({ length: 25 }, (_, i) => ({
      ...batch,
      sellerId: `seller-${i}`,
    })),
  });
  expect(
    nodes(h.render()).filter(
      (n) =>
        n.type === 'button' &&
        String(n.props['aria-label']).startsWith('Ver detalle de '),
    ).length,
  ).toBe(20);
  expect(renderToStaticMarkup(h.render())).not.toContain('lg:grid-cols-2');
});
it('runs one reviewed serial batch, stops on rejection and retains progress during loading and empty states', async () => {
  const calls: string[] = [];
  const busy: boolean[] = [];
  const sellers = ['seller-a', 'seller-b', 'seller-c'];
  const h = harness({
    batches: sellers.map((sellerId) => ({ ...batch, sellerId })),
    selectedShipmentsBySeller: Object.fromEntries(
      sellers.map((id) => [id, ['shipment-ready']]),
    ),
    onBusyChange: (value: boolean) => busy.push(value),
    onRelease: async (id: string) => {
      calls.push(id);
      if (id === 'seller-b') throw new Error('UNCERTAIN');
    },
  });
  await h.click('Liberar');
  await h.click('Confirmar liberación');
  expect(calls).toEqual(['seller-a', 'seller-b']);
  expect(busy).toEqual([true, false]);
  for (const loading of [true, false]) {
    h.props.isLoading = loading;
    h.props.batches = [];
    const html = renderToStaticMarkup(h.render());
    expect(html).toContain('1 aceptadas');
    expect(html).toContain('1 sin intentar');
    expect(html).toContain('UNCERTAIN');
  }
});
it('checks latest remaining seller authority after each awaited release', async () => {
  const calls: string[] = [];
  const second = { ...batch, sellerId: 'seller-b' };
  const h = harness({
    batches: [batch, second],
    selectedShipmentsBySeller: {
      'seller-a': ['shipment-ready'],
      'seller-b': ['shipment-ready'],
    },
    onRelease: async (id: string) => {
      calls.push(id);
      h.props.batches = [batch, { ...second, stripeAccountId: 'changed' }];
      h.render();
    },
  });
  await h.click('Liberar');
  await h.click('Confirmar liberación');
  expect(calls).toEqual(['seller-a']);
  expect(renderToStaticMarkup(h.render())).toContain('seller-b');
});
it('invalidates review permanently through loading even if original data returns', async () => {
  const h = harness();
  await h.click('Liberar');
  h.props.isLoading = true;
  h.render();
  h.props.isLoading = false;
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Confirmar liberación',
  );
});
it('excludes zero-value eligible shipments from global and reviewed selections', async () => {
  const selections: unknown[] = [];
  const h = harness({
    batches: [
      {
        ...batch,
        shipments: batch.shipments.map((s) => ({
          ...s,
          releaseAmountCents: 0,
        })),
      },
    ],
    onSelectEligibleBatch: (...args: unknown[]) => selections.push(args),
  });
  await h.click('Seleccionar todos los elegibles');
  expect(selections).toEqual([['seller-a', []]]);
  expect(
    nodes(h.render()).find(
      (n) =>
        n.type === 'button' &&
        label(n.props.children as React.ReactNode) === 'Liberar',
    )?.props.disabled,
  ).toBe(true);
});
it('waits for acceptance before attempting the next seller and locks all batch controls', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const calls: string[] = [];
  const h = harness({
    batches: [batch, { ...batch, sellerId: 'seller-b' }],
    selectedShipmentsBySeller: {
      'seller-a': ['shipment-ready'],
      'seller-b': ['shipment-ready'],
    },
    onRelease: async (id: string) => {
      calls.push(id);
      if (id === 'seller-a') await pending;
    },
  });
  await h.click('Liberar');
  const confirm = nodes(h.render()).find(
    (n) =>
      n.type === 'button' &&
      label(n.props.children as React.ReactNode) === 'Confirmar liberación',
  )!.props.onClick as () => Promise<void>;
  const request = confirm();
  expect(calls).toEqual(['seller-a']);
  expect(
    nodes(h.render())
      .filter((n) => n.type === 'button' || n.type === 'input')
      .every((n) => n.props.disabled === true),
  ).toBe(true);
  finish();
  await request;
  expect(calls).toEqual(['seller-a', 'seller-b']);
});
it('preserves global selection while changing visual page without opening details', async () => {
  const h = harness({
    batches: Array.from({ length: 25 }, (_, i) => ({
      ...batch,
      sellerId: `seller-${i}`,
      sellerName: `Name${i}`,
    })),
  });
  const pagination = nodes(h.render()).find(
    (n) => typeof n.type === 'function' && n.props.label === 'vendedores',
  )!;
  (pagination.props.onPageChange as (page: number) => void)(1);
  expect(
    nodes(h.render()).filter(
      (n) =>
        n.type === 'button' &&
        String(n.props['aria-label']).startsWith('Ver detalle de '),
    ).length,
  ).toBe(5);
  expect(renderToStaticMarkup(h.render())).toContain('@Name20');
  expect(h.props.selectedShipmentsBySeller['seller-a']).toContain(
    'shipment-ready',
  );
});
it('does not dispatch a retained confirmation handler after review was invalidated', async () => {
  const h = harness();
  await h.click('Liberar');
  const confirm = nodes(h.render()).find(
    (n) =>
      n.type === 'button' &&
      label(n.props.children as React.ReactNode) === 'Confirmar liberación',
  )!.props.onClick as () => Promise<void>;
  h.props.isLoading = true;
  h.render();
  h.props.isLoading = false;
  h.render();
  await confirm();
  expect(h.calls).toEqual([]);
});
it('preserves existing seller detail contents inside the modal', () => {
  const h = harness();
  h.openDetail();
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('aria-label="Vendedores por liberar"');
  expect(html).toContain('aria-label="Detalle de liberación"');
  expect(html).toContain('acct_a');
  expect(html).toContain('shipment-blocked');
});
it('requires review then explicit confirmation and excludes blocked or stale selection from the amount', async () => {
  const h = harness();
  await h.click('Liberar');
  expect(h.calls).toEqual([]);
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('Confirmar liberación');
  expect(html).toContain('no confirma que ya haya llegado a su cuenta.');
  expect(html).toContain('$125');
  expect(html).not.toContain('$1,025');
  await h.click('Confirmar liberación');
  expect(h.calls).toEqual(['seller-a']);
});
it('preserves disabled blocked shipments and prevents release while a mutation is pending', () => {
  const h = harness();
  h.openDetail();
  h.props.isReleasing = true;
  const inputs = nodes(h.render()).filter((node) => node.type === 'input');
  expect(
    inputs.filter((node) =>
      String(node.props['aria-label']).startsWith('Seleccionar envío'),
    ).length,
  ).toBe(2);
  expect(inputs.every((node) => node.props.disabled === true)).toBe(true);
  const review = nodes(h.render()).find(
    (node) =>
      node.type === 'button' &&
      label(node.props.children as React.ReactNode) === 'Liberar',
  );
  expect(review?.props.disabled).toBe(true);
});
it('shows the queue loading state instead of claiming empty or exposing actions', () => {
  const h = harness({ isLoading: true });
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('Consultando cola de dispersión en Stripe Connect...');
  expect(html).not.toContain('Liberar');
});
it('does not claim money was dispersed when the resolved result is empty', () => {
  const h = harness({ batches: [] });
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('No hay pagos pendientes de liberación');
  expect(html).not.toContain('han sido dispersados');
});
it('invalidates review when selection or refreshed amount changes', async () => {
  const h = harness();
  await h.click('Liberar');
  h.props.selectedShipmentsBySeller = { 'seller-a': ['shipment-blocked'] };
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Confirmar liberación',
  );
  expect(h.calls).toEqual([]);
  h.props.selectedShipmentsBySeller = { 'seller-a': ['shipment-ready'] };
  await h.click('Liberar');
  h.props.batches = [
    {
      ...batch,
      totalEligibleAmountCents: 12600,
      shipments: batch.shipments.map((shipment) =>
        shipment.isEligible
          ? { ...shipment, releaseAmountCents: 12600 }
          : shipment,
      ),
    },
  ];
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Confirmar liberación',
  );
  expect(h.calls).toEqual([]);
});
it('invalidates review when the displayed Connect account changes on refresh', async () => {
  const h = harness();
  await h.click('Liberar');
  h.props.batches = [{ ...batch, stripeAccountId: 'acct_changed' }];
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Confirmar liberación',
  );
  expect(h.calls).toEqual([]);
});
it('dispatches one release for two rapid confirmations and keeps controls disabled in flight', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const calls: string[] = [];
  const h = harness({
    onRelease: async (id: string) => {
      calls.push(id);
      await pending;
    },
  });
  await h.click('Liberar');
  const button = nodes(h.render()).find(
    (node) =>
      node.type === 'button' &&
      label(node.props.children as React.ReactNode) === 'Confirmar liberación',
  )!;
  const confirm = button.props.onClick as () => Promise<void>;
  const first = confirm();
  const second = confirm();
  expect(calls).toEqual(['seller-a']);
  expect(
    nodes(h.render())
      .filter((node) => node.type === 'input')
      .every((node) => node.props.disabled === true),
  ).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(calls).toEqual(['seller-a']);
});
it('keeps selection and presents a failed release without an unhandled rejection', async () => {
  const h = harness({
    onRelease: async () => {
      throw new Error('ACCOUNT_NOT_ACTIONABLE');
    },
  });
  await h.click('Liberar');
  await h.click('Confirmar liberación');
  expect(renderToStaticMarkup(h.render())).toContain('ACCOUNT_NOT_ACTIONABLE');
  expect(h.props.selectedShipmentsBySeller['seller-a']).toEqual([
    'shipment-ready',
    'shipment-blocked',
    'stale',
  ]);
});
