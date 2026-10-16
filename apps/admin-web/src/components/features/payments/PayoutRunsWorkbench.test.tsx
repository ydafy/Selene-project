import { SelectionActionSummary } from '../../ui/SelectionActionSummary';
import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayoutRunsWorkbench } from './PayoutRunsWorkbench';
import type { ReleaseQueueActionRequiredRun } from '../../../lib/connectPayoutReleaseQueue';

const run: ReleaseQueueActionRequiredRun = {
  runId: 'run-failed',
  retryOfRunId: 'run-parent',
  sellerId: 'seller-a',
  sellerName: 'Aurora',
  status: 'failed',
  amountCents: 12500,
  reason: 'retryable_failed',
  canRetry: true,
  failureReason: 'BANK_REJECTED',
  failedAt: '2026-10-01T12:00:00Z',
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
  const effects: (() => void)[] = [];
  spyOn(React, 'useLayoutEffect').mockImplementation((effect) => {
    effects.push(() => {
      effect();
    });
  });
  const calls: string[] = [];
  const props = {
    isLoading: false,
    mode: 'action-required' as const,
    runs: [run],
    isReleasing: false,
    isRetrying: false,
    onRetryFailedPayout: async (runId: string) => {
      calls.push(runId);
    },
    ...overrides,
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    const tree = PayoutRunsWorkbench(props);
    effects.splice(0).forEach((effect) => effect());
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
    const card = nodes(render()).find(
      (n) => n.props['aria-haspopup'] === 'dialog',
    )!;
    expect(card).toBeDefined();
    expect(card.props.disabled).not.toBe(true);
    (card.props.onClick as () => void)();
  };
  return { render, click, calls, props, openDetail };
}
afterEach(() => mock.restore());

it('loads all 21 retry groups independently of the page and retains off-page selection', async () => {
  const all = Array.from({ length: 21 }, (_, i) => ({ ...run, runId: `run-${i}` }));
  const h = harness({ runs: [all[20]], pagination: { page: 1, totalGroups: 21 },
    onPageChange: () => undefined, onSelectAll: async () => all });
  expect(renderToStaticMarkup(h.render())).toContain('Página 2 de 2');
  await h.click('Seleccionar todos los reintentables');
  expect(h.calls).toEqual([]);
  h.openDetail();
  const checkbox = nodes(h.render()).find((node) => node.type === 'input' && node.props.type === 'checkbox')!;
  expect(checkbox.props.checked).toBe(true);
  (checkbox.props.onChange as () => void)();
  expect(renderToStaticMarkup(h.render())).toContain('20 seleccionadas');
  (nodes(h.render()).find((node) => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange as () => void)();
  await h.click('Reintentar');
  await h.click('Confirmar reintento');
  expect(h.calls).toEqual(all.map((item) => item.runId));
});

it('reviews all 21 fresh retry selections despite an older visible nonretryable run', async () => {
  const all = Array.from({ length: 21 }, (_, i) => ({ ...run, runId: `run-${i}` }));
  const h = harness({ runs: [{ ...all[0], canRetry: false, reason: 'failed' }],
    pagination: { page: 0, totalGroups: 21 }, pageRevision: 'old-page', onSelectAll: async () => all });
  await h.click('Seleccionar todos los reintentables');
  expect(renderToStaticMarkup(h.render())).toContain('21 seleccionadas');
  expect(h.calls).toEqual([]);
  h.openDetail();
  const checkbox = () => nodes(h.render()).find((node) => node.type === 'input' && node.props.type === 'checkbox')!;
  expect(checkbox().props.disabled).not.toBe(true);
  (checkbox().props.onChange as () => void)();
  expect(renderToStaticMarkup(h.render())).toContain('20 seleccionadas');
  (checkbox().props.onChange as () => void)();
  await h.click('Reintentar'); await h.click('Confirmar reintento');
  expect(h.calls).toEqual(all.map((item) => item.runId));
});

it('a later page drift revokes a fresh complete-selection confirmation', async () => {
  const h = harness({ runs: [run], pagination: { page: 0, totalGroups: 1 },
    pageRevision: 'old-page', onSelectAll: async () => [run] });
  await h.click('Seleccionar todos los reintentables'); await h.click('Reintentar');
  const confirm = nodes(h.render()).find((node) => node.type === 'button' && label(node) === 'Confirmar reintento')!;
  Object.assign(h.props, { runs: [{ ...run, amountCents: 999 }], pageRevision: 'later-page' });
  expect(renderToStaticMarkup(h.render())).not.toContain('Confirmar reintento');
  await (confirm.props.onClick as () => Promise<void>)();
  expect(h.calls).toEqual([]);
});

it('a failed complete-selection fetch installs no partial retry selection', async () => {
  const h = harness({ onSelectAll: async () => { throw new Error('Consulta incompleta'); } });
  await h.click('Seleccionar todos los reintentables');
  expect(renderToStaticMarkup(h.render())).toContain('Consulta incompleta');
  expect(h.calls).toEqual([]);
  expect(nodes(h.render()).find((n) => n.type === 'button' && label(n) === 'Reintentar')?.props.disabled).toBe(true);
});

it('uses the shared prominent summary and only reviews eligible retries before confirmation', async () => {
  const h = harness({
    runs: [
      run,
      { ...run, runId: 'blocked', canRetry: false, reason: 'failed' },
    ],
  });
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('Total a reintentar');
  expect(html).toContain('w-fit');
  expect(html).toContain('text-3xl font-bold tabular-nums');
  await h.click('Seleccionar todos los reintentables');
  const retry = nodes(h.render()).find(
    (n) => n.type === 'button' && label(n) === 'Reintentar',
  )!;
  expect(retry.props.className).toContain('bg-lion');
  await h.click('Reintentar');
  expect(h.calls).toEqual([]);
  expect(renderToStaticMarkup(h.render())).toContain('Confirmar reintento');
  await h.click('Confirmar reintento');
  expect(h.calls).toEqual(['run-failed']);
});
it('opens attention details in a modal without selecting or retrying and shows reported reason first', () => {
  const h = harness();
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Detalle de dispersión',
  );
  const card = nodes(h.render()).find(
    (n) => n.props['aria-haspopup'] === 'dialog',
  )!;
  expect(card).toBeDefined();
  (card.props.onClick as () => void)();
  const tree = h.render();
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('<dialog');
  expect(html).toContain('Motivo reportado');
  expect(html).toContain('BANK_REJECTED');
  expect(html.indexOf('Motivo reportado')).toBeLessThan(
    html.indexOf('Acción disponible'),
  );
  expect(html).not.toContain('Qué necesita atención');
  expect(html).toContain('Copiar ID de ejecución');
  expect(html).toContain('Copiar ID de vendedor');
  expect(html).toContain('Copiar Reintento de');
  expect(html).not.toContain('Copiar ID de payout');
  expect(h.calls).toEqual([]);
  const modal = nodes(tree).find(
    (n) => n.props.title === 'Detalle de dispersión',
  )!;
  (modal.props.onClose as () => void)();
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Detalle de dispersión',
  );
});
it('shows truthful absent reported-reason fallback and blocks nonretryable selection inside details', () => {
  const h = harness({
    runs: [
      {
        ...run,
        canRetry: false,
        reason: 'reconciliation_needed',
        status: 'reconciliation_needed',
        failureReason: null,
      },
    ],
  });
  const card = nodes(h.render()).find(
    (n) => n.props['aria-haspopup'] === 'dialog',
  )!;
  expect(card).toBeDefined();
  (card.props.onClick as () => void)();
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('No se recibió un motivo de fallo.');
  expect(html).toContain('no vuelvas a liberar estos fondos');
  const checkbox = nodes(h.render()).find((n) => n.type === 'input')!;
  expect(checkbox.props.disabled).toBe(true);
  (checkbox.props.onChange as () => void)();
  expect(h.calls).toEqual([]);
  expect(renderToStaticMarkup(h.render())).not.toContain('Confirmar reintento');
});
it('uses taller twenty-row attention pages without list scrolling or lateral checkboxes', async () => {
  const h = harness({
    runs: Array.from({ length: 21 }, (_, i) => ({
      ...run,
      runId: `run-${i}`,
      sellerName: `seller-${i}`,
    })),
  });
  const tree = h.render();
  expect(
    nodes(tree).filter((n) => n.props['aria-haspopup'] === 'dialog'),
  ).toHaveLength(20);
  expect(nodes(tree).some((n) => n.type === 'input')).toBe(false);
  const list = nodes(tree).find(
    (n) => n.props['aria-label'] === 'Dispersiones',
  )!;
  expect(renderToStaticMarkup(list)).not.toContain('overflow-y-auto');
  expect(renderToStaticMarkup(tree)).not.toContain('lg:grid-cols-2');
  const pagination = nodes(tree).find((n) => n.props.label === 'dispersiones')!;
  expect(pagination.props.display).toBe('pages');
  await h.click('Seleccionar todos los reintentables');
  const selected = nodes(h.render()).find(
    (n) => n.props['aria-haspopup'] === 'dialog',
  )!;
  expect(selected.props.className).toContain('bg-forest/10');
  expect(label(selected)).toContain('Seleccionada para reintentar');
  (pagination.props.onPageChange as (page: number) => void)(1);
  expect(
    nodes(h.render()).filter((n) => n.props['aria-haspopup'] === 'dialog'),
  ).toHaveLength(1);
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Detalle de dispersión',
  );
});
it('opens and closes existing read-only history details only through its card modal', () => {
  const h = harness({ mode: 'history', runs: [{ ...run, status: 'paid' }] });
  expect(renderToStaticMarkup(h.render())).not.toContain(
    'Detalle de dispersión',
  );
  h.openDetail();
  const tree = h.render();
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('<dialog');
  expect(html).toContain('Pago observado');
  expect(html).toContain('@Aurora');
  expect(html).toContain('$125');
  expect(html).toContain('Resultado observado');
  expect(html).toContain('no es una garantía irreversible');
  expect(html).toContain('run-failed');
  expect(html).toContain('run-parent');
  expect(html).toContain('seller-a');
  expect(html).toContain('Referencias técnicas');
  expect(nodes(tree).some((n) => n.type === 'input')).toBe(false);
  expect(html).not.toContain('Reintentar');
  expect(html).not.toContain('Liberar');
  expect(html).not.toContain('Confirmar');
  expect(h.calls).toEqual([]);
  const modal = nodes(tree).find(
    (n) => n.props.title === 'Detalle de dispersión',
  )!;
  (modal.props.onClose as () => void)();
  expect(renderToStaticMarkup(h.render())).not.toContain('<dialog');
  expect(h.calls).toEqual([]);
});
it('uses tall twenty-row page-scroll history cards and preserves supplied order with unavailable dates', () => {
  const h = harness({
    mode: 'history',
    runs: Array.from({ length: 21 }, (_, i) => ({
      ...run,
      status: 'paid',
      runId: `paid-${i}`,
      sellerName: `history-${20 - i}`,
    })),
  });
  const tree = h.render();
  const cards = nodes(tree).filter(
    (n) => n.props['aria-haspopup'] === 'dialog',
  );
  expect(cards).toHaveLength(20);
  expect(cards[0].props.className).toContain('py-7');
  expect(label(cards[0])).toContain('@history-20');
  expect(label(cards[19])).toContain('@history-1');
  const html = renderToStaticMarkup(tree);
  expect(html).not.toContain('lg:grid-cols-2');
  expect(html).not.toContain('overflow-y-auto');
  expect(html).not.toContain('Detalle de dispersión');
  expect(html).toContain('Fecha de pago observada');
  expect(html).toContain('No disponible');
  const pagination = nodes(tree).find((n) => n.props.label === 'dispersiones')!;
  expect(pagination.props.display).toBe('pages');
  (cards[0].props.onClick as () => void)();
  expect(renderToStaticMarkup(h.render())).toContain('<dialog');
  (pagination.props.onPageChange as (page: number) => void)(1);
  const next = h.render();
  const nextCards = nodes(next).filter(
    (n) => n.props['aria-haspopup'] === 'dialog',
  );
  expect(nextCards).toHaveLength(1);
  expect(label(nextCards[0])).toContain('@history-0');
  expect(renderToStaticMarkup(next)).not.toContain('<dialog');
  expect(h.calls).toEqual([]);
});
it('removes history details when their paid run leaves the refreshed queue and gates loading/empty states', () => {
  const h = harness({ mode: 'history', runs: [{ ...run, status: 'paid' }] });
  h.openDetail();
  h.props.isLoading = true;
  let html = renderToStaticMarkup(h.render());
  expect(html).toContain('Consultando cola');
  expect(html).not.toContain('<dialog');
  h.props.isLoading = false;
  h.props.runs = [];
  html = renderToStaticMarkup(h.render());
  expect(html).toContain('Sin dispersiones pagadas todavía');
  expect(html).not.toContain('Detalle de dispersión');
  expect(h.calls).toEqual([]);
});
it('revokes retained confirmation handlers on cancel, clear, drift, loading and completion', async () => {
  for (const change of [
    'cancel',
    'clear',
    'amount',
    'authority',
    'loading',
    'complete',
  ]) {
    const h = harness();
    await h.click('Seleccionar todos los reintentables');
    await h.click('Reintentar');
    const button = nodes(h.render()).find(
      (node) =>
        node.type === 'button' &&
        label(node.props.children as React.ReactNode) === 'Confirmar reintento',
    )!;
    const retained = button.props.onClick as () => Promise<void>;
    if (change === 'cancel') await h.click('Volver a revisar');
    if (change === 'clear') await h.click('Limpiar selección');
    if (change === 'amount' || change === 'authority') {
      h.props.runs = [
        {
          ...run,
          ...(change === 'amount' ? { amountCents: 1 } : { canRetry: false }),
        },
      ];
      h.render();
      h.props.runs = [run];
      h.render();
    }
    if (change === 'loading') {
      h.props.isLoading = true;
      h.render();
      h.props.isLoading = false;
      h.render();
    }
    if (change === 'complete') await retained();
    await retained();
    expect(h.calls, change).toEqual(
      change === 'complete' ? ['run-failed'] : [],
    );
    mock.restore();
  }
});
it('keeps outcomes visible during loading and places batch confirmation above panels', async () => {
  const h = harness();
  await h.click('Seleccionar todos los reintentables');
  await h.click('Reintentar');
  const html = renderToStaticMarkup(h.render());
  expect(html.indexOf('Confirmación de reintento')).toBeLessThan(
    html.indexOf('aria-label="Dispersiones"'),
  );
  await h.click('Confirmar reintento');
  h.props.isLoading = true;
  const loading = renderToStaticMarkup(h.render());
  expect(loading).toContain('1 aceptadas');
  expect(loading).not.toContain('Revisar reintento');
});
it('stops remaining callbacks when the committed queue enters loading', async () => {
  const calls: string[] = [];
  const h = harness({
    runs: [run, { ...run, runId: 'second' }],
    onRetryFailedPayout: async (id: string) => {
      calls.push(id);
      h.props.isLoading = true;
      h.render();
    },
  });
  await h.click('Seleccionar todos los reintentables');
  await h.click('Reintentar');
  await h.click('Confirmar reintento');
  expect(calls).toEqual(['run-failed']);
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('1 aceptadas');
  expect(html).toContain('detenida en second');
  h.props.isLoading = false;
  h.props.runs = [];
  expect(renderToStaticMarkup(h.render())).toContain('detenida en second');
});
it('blocked checkbox callbacks cannot create reviewed money actions', async () => {
  const h = harness({ runs: [{ ...run, canRetry: false }] });
  h.openDetail();
  const checkbox = nodes(h.render()).find((node) => node.type === 'input')!;
  expect(checkbox.props.disabled).toBe(true);
  (checkbox.props.onChange as () => void)();
  expect(renderToStaticMarkup(h.render())).toContain('0 seleccionadas');
  expect(renderToStaticMarkup(h.render())).not.toContain('Confirmar reintento');
  expect(h.calls).toEqual([]);
});
it('bounds queried rows and offers cross-page retry selection only in attention', async () => {
  const h = harness({
    runs: Array.from({ length: 21 }, (_, i) => ({ ...run, runId: `run-${i}` })),
  });
  const html = renderToStaticMarkup(h.render());
  expect(html).not.toContain('run-20');
  expect(html).toContain('Seleccionar todos los reintentables');
  await h.click('Seleccionar todos los reintentables');
  await h.click('Reintentar');
  await h.click('Confirmar reintento');
  expect(h.calls).toHaveLength(21);
});
it('stops a serial batch on rejection and retains unattempted selection and outcome through empty data', async () => {
  const calls: string[] = [];
  const busy: boolean[] = [];
  const h = harness({
    runs: [run, { ...run, runId: 'second' }, { ...run, runId: 'third' }],
    onBusyChange: (value: boolean) => busy.push(value),
    onRetryFailedPayout: async (id: string) => {
      calls.push(id);
      if (id === 'second') throw new Error('BANK_PENDING');
    },
  });
  await h.click('Seleccionar todos los reintentables');
  await h.click('Reintentar');
  await h.click('Confirmar reintento');
  expect(calls).toEqual(['run-failed', 'second']);
  expect(busy).toEqual([true, false]);
  expect(renderToStaticMarkup(h.render())).toContain('2 seleccionadas');
  h.props.runs = [];
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('BANK_PENDING');
  expect(html).toContain('1 aceptadas');
  expect(html).toContain('1 sin intentar');
});
it('checks refreshed remaining authority before each callback and permanently discards empty reviews', async () => {
  const calls: string[] = [];
  const h = harness({
    runs: [run, { ...run, runId: 'second' }],
    onRetryFailedPayout: async (id: string) => {
      calls.push(id);
      h.props.runs = [run, { ...run, runId: 'second', amountCents: 1 }];
      h.render();
    },
  });
  await h.click('Seleccionar todos los reintentables');
  await h.click('Reintentar');
  await h.click('Confirmar reintento');
  expect(calls).toEqual(['run-failed']);
  h.openDetail();
  await h.click('Revisar reintento');
  h.props.runs = [];
  h.render();
  h.props.runs = [run];
  expect(renderToStaticMarkup(h.render())).not.toContain('Confirmar reintento');
});

it('keeps unsafe checkboxes disabled and history retry references inside technical disclosure', () => {
  const h = harness({
    runs: [
      run,
      { ...run, runId: 'blocked', canRetry: false },
      { ...run, runId: 'ambiguous', reason: 'reconciliation_needed' },
      { ...run, runId: 'canceled', status: 'canceled' },
    ],
  });
  const cards = nodes(h.render()).filter(
    (node) => node.props['aria-haspopup'] === 'dialog',
  );
  const disabled = cards.map((card) => {
    (card.props.onClick as () => void)();
    const checkbox = nodes(h.render()).find((node) => node.type === 'input')!;
    return checkbox.props.disabled;
  });
  expect(disabled).toEqual([false, true, true, true]);
  for (const mode of ['processing', 'history']) {
    h.props.mode = mode as 'action-required';
    if (mode === 'history') h.openDetail();
    const tree = h.render();
    expect(nodes(tree).some((node) => node.type === 'input')).toBe(false);
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain('Reintentar');
    expect(html).toContain('Fue un reintento');
    const disclosure = nodes(tree).find((node) => node.type === 'details')!;
    expect(label(disclosure)).toContain('Reintento derun-parent');
  }
});
it('changes visual pages without losing cross-page selected summary', async () => {
  const h = harness({
    runs: Array.from({ length: 21 }, (_, i) => ({
      ...run,
      runId: `run-${i}`,
      sellerName: `seller-${i}`,
    })),
  });
  await h.click('Seleccionar todos los reintentables');
  const pagination = nodes(h.render()).find(
    (node) =>
      typeof node.type === 'function' && node.props.label === 'dispersiones',
  )!;
  (pagination.props.onPageChange as (page: number) => void)(1);
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('21 seleccionadas');
  expect(html).toContain('@seller-20');
  expect(html).not.toContain('@seller-0');
  expect(html).not.toContain('overflow-y-auto');
});
it('offers a compact operations list and contextual diagnostics with original/retry references', () => {
  const h = harness();
  h.openDetail();
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('aria-label="Dispersiones"');
  expect(html).toContain('aria-label="Detalle de dispersión"');
  expect(html).toContain('run-parent');
  expect(html).toContain('BANK_REJECTED');
});
it('reviews a failed payout before confirming one run-scoped retry', async () => {
  const h = harness();
  h.openDetail();
  await h.click('Revisar reintento');
  expect(h.calls).toEqual([]);
  expect(renderToStaticMarkup(h.render())).toContain(
    'reutiliza las transferencias existentes',
  );
  await h.click('Confirmar reintento');
  expect(h.calls).toEqual(['run-failed']);
});
it('individual review closes details and exposes a focusable shared confirmation', async () => {
  const h = harness();
  h.openDetail();
  await h.click('Revisar reintento');
  const tree = h.render();
  expect(renderToStaticMarkup(tree)).not.toContain('<dialog');
  const confirmation = nodes(tree).find(
    (n) => n.props['aria-label'] === 'Confirmación de reintento',
  )!;
  expect(confirmation.props.tabIndex).toBe(-1);
  expect(h.calls).toEqual([]);
});
it('retains read-only guards for ambiguous, canceled and nonretryable failures', () => {
  for (const blocked of [
    {
      ...run,
      status: 'reconciliation_needed',
      reason: 'reconciliation_needed' as const,
      canRetry: false,
    },
    {
      ...run,
      status: 'canceled',
      reason: 'canceled' as const,
      canRetry: false,
    },
    { ...run, reason: 'failed' as const, canRetry: false },
  ]) {
    const html = renderToStaticMarkup(harness({ runs: [blocked] }).render());
    expect(html).not.toContain('Revisar reintento');
    expect(html).toContain('Sin reintento disponible');
    mock.restore();
  }
});
it('processing and history never expose money actions even with a retryable-shaped row', () => {
  for (const mode of ['processing', 'history']) {
    const h = harness({ mode });
    if (mode === 'history') h.openDetail();
    const html = renderToStaticMarkup(h.render());
    expect(html).not.toContain('Revisar reintento');
    expect(html).toContain(
      mode === 'processing'
        ? 'No requiere otra autorización'
        : 'no es una garantía irreversible',
    );
    mock.restore();
  }
});
it('prevents retries while either financial mutation is pending', () => {
  for (const flags of [{ isRetrying: true }, { isReleasing: true }]) {
    const h = harness();
    h.openDetail();
    Object.assign(h.props, flags);
    const button = nodes(h.render()).find(
      (node) =>
        node.type === 'button' &&
        label(node.props.children as React.ReactNode) === 'Revisar reintento',
    );
    expect(button?.props.disabled).toBe(true);
    mock.restore();
  }
});
it('invalidates retry review after a refreshed amount or retry authority changes', async () => {
  const h = harness();
  h.openDetail();
  await h.click('Revisar reintento');
  h.props.runs = [{ ...run, amountCents: 12600 }];
  expect(renderToStaticMarkup(h.render())).not.toContain('Confirmar reintento');
  h.props.runs = [run];
  expect(renderToStaticMarkup(h.render())).not.toContain('Confirmar reintento');
  h.openDetail();
  await h.click('Revisar reintento');
  h.props.runs = [{ ...run, canRetry: false, reason: 'failed' }];
  expect(renderToStaticMarkup(h.render())).not.toContain('Confirmar reintento');
  expect(h.calls).toEqual([]);
});
it('dispatches one run-scoped retry for two rapid confirmations', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const calls: string[] = [];
  const h = harness({
    onRetryFailedPayout: async (id: string) => {
      calls.push(id);
      await pending;
    },
  });
  h.openDetail();
  await h.click('Revisar reintento');
  const button = nodes(h.render()).find(
    (node) =>
      node.type === 'button' &&
      label(node.props.children as React.ReactNode) === 'Confirmar reintento',
  )!;
  const confirm = button.props.onClick as () => Promise<void>;
  const first = confirm();
  const second = confirm();
  expect(calls).toEqual(['run-failed']);
  expect(
    nodes(h.render())
      .filter((node) => node.type === 'button')
      .every((node) => node.props.disabled === true),
  ).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(calls).toEqual(['run-failed']);
});
it('keeps missing seller attribution readable and retry rejection visible', async () => {
  const h = harness({
    runs: [{ ...run, sellerId: null, sellerName: null }],
    onRetryFailedPayout: async () => {
      throw new Error('RETURNED_FUNDS_PENDING');
    },
  });
  h.openDetail();
  await h.click('Revisar reintento');
  await h.click('Confirmar reintento');
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('Vendedor no identificado');
  expect(html).not.toContain('@null');
  expect(html).toContain('RETURNED_FUNDS_PENDING');
});


it('shows the observed payment timestamp in History cards and details without money actions', () => {
  const paidAt = '2026-10-15T12:34:00Z';
  const h = harness({ mode: 'history', runs: [{ ...run, status: 'paid', paidAt }] });
  const cardTree = h.render();
  const cardTime = nodes(cardTree).find((node) => node.type === 'time');
  expect(cardTime).toBeDefined();
  expect(cardTime!.props.dateTime).toBe(paidAt);
  expect(label(cardTree)).toContain('Fecha de pago observada');
  expect(label(cardTime)).toMatch(/15\/10\/2026/);
  h.openDetail();
  const detailTree = h.render();
  const detail = nodes(detailTree).find((node) => node.props['aria-label'] === 'Detalle de dispersión')!;
  expect(detail).toBeDefined();
  expect(label(detail)).toContain('Fecha de pago observada');
  expect(nodes(detail).some((node) => node.type === 'time' && node.props.dateTime === paidAt)).toBe(true);
  const html = renderToStaticMarkup(detailTree);
  expect(html).toContain('no es una garantía irreversible');
  expect(html).not.toContain('Confirmar reintento');
  expect(html).not.toContain('Seleccionar para reintentar');
  expect(h.calls).toEqual([]);
});

it('shows unavailable payment dates without using failure or retry dates and leaves other modes unchanged', () => {
  for (const paidAt of [null, 'invalid']) {
    const h = harness({ mode: 'history', runs: [{ ...run, status: 'paid', paidAt }] });
    expect(label(h.render())).toContain('Fecha de pago observada');
    expect(label(h.render())).toContain('No disponible');
    expect(nodes(h.render()).some((node) => node.type === 'time')).toBe(false);
    h.openDetail();
    const detail = nodes(h.render()).find((node) => node.props['aria-label'] === 'Detalle de dispersión')!;
    expect(label(detail)).toContain('No disponible');
    expect(nodes(detail).some((node) => node.type === 'time')).toBe(false);
    expect(h.calls).toEqual([]);
  }
  for (const mode of ['processing', 'action-required']) {
    const h = harness({ mode, runs: [{ ...run, paidAt: '2026-10-15T12:34:00Z' }] });
    if (mode === 'action-required') h.openDetail();
    expect(label(h.render())).not.toContain('Fecha de pago observada');
    expect(h.calls).toEqual([]);
  }
});
