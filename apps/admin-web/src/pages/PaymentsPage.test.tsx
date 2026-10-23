import { afterAll, afterEach, beforeEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import type { ReleaseQueueBatch, ReleaseQueueActionRequiredRun } from '../lib/connectPayoutReleaseQueue';

if (process.env.PAYOUT_PAGING_PAGE_CHILD !== '1') {
  it('checks paginated page handlers in an isolated offline process', () => {
    const result = Bun.spawnSync({ cmd: [process.execPath, 'test', import.meta.filename],
      env: { ...process.env, PAYOUT_PAGING_PAGE_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe' });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const deny = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(
    () => { throw new Error('Unexpected external request'); },
    { preconnect: () => { throw new Error('Unexpected external request'); } },
  ));
  afterAll(() => deny.mockRestore());
  const batch = (i: number): ReleaseQueueBatch => ({ sellerId: `seller-${i}`, sellerName: `Seller ${i}`,
    stripeAccountId: 'acct', totalEligibleAmountCents: 100, eligibleShipmentCount: 1,
    ineligibleShipmentCount: 0, releaseState: 'ready', shipments: [{ shipmentId: `shipment-${i}`,
      orderId: `order-${i}`, completedAt: null, isEligible: true, ineligibleReason: null,
      releaseAmountCents: 100, reconciliationIndicator: 'ready_for_release', status: 'completed', stripePaymentIntentId: null }] });
  const run: ReleaseQueueActionRequiredRun = { runId: 'offpage-run', sellerId: 'seller', sellerName: 'Seller',
    retryOfRunId: null, status: 'failed', amountCents: 100, reason: 'retryable_failed', canRetry: true, failureReason: null, failedAt: null };
  let freshBatches: ReleaseQueueBatch[];
  let freshRuns: ReleaseQueueActionRequiredRun[];
  let selectionError: Error | null;
  let selectionReads = 0;
  let selectionWait: Promise<void> | null = null;
  let releaseCalls: unknown[] = [];
  let retryCalls: unknown[] = [];
  let lastOptions: { bucket: string; page: number };
  let lastSearch = '';
  let serverPage = 0;
  let queryError = false;
  let queryLoading = false;
  let pageRevision = 1;
  let queryLastSuccess: number | null = null;
  let visibleOverride: ReleaseQueueBatch[] | null = null;
  mock.module('../hooks/useDebounce', () => ({ useDebounce: (value: string) => value }));
  mock.module('../hooks/useConnectPayoutReleaseQueue', () => ({
    useConnectPayoutReleaseQueue: (search: string, options: { bucket: string; page: number }) => {
      lastSearch = search; lastOptions = options;
      return { batches: visibleOverride ?? [batch(serverPage === 0 ? 0 : 20)], processingRuns: [], actionRequiredRuns: [], historyRuns: [],
        pageRevision,
        lastSuccessfulFetchAt: queryLastSuccess,
        pagination: { page: Math.min(options.page, serverPage), totalGroups: 21 },
        counts: { ready: 21, processing: 0, 'action-required': 1, history: 0 },
        isLoading: queryLoading, isFetching: false, isError: queryError, isReleasing: false, isRetrying: false,
        fetchSelection: async () => { selectionReads++;
          const snapshot = { releaseBatches: freshBatches, actionRequiredRuns: freshRuns };
          if (selectionWait) await selectionWait; if (selectionError) throw selectionError;
          return snapshot; },
        releaseSelectedShipments: async (input: unknown) => { releaseCalls.push(input); },
        retryFailedPayout: async (input: unknown) => { retryCalls.push(input); },
        refetch: async () => ({ isError: false }),
      };
    },
  }));
  mock.module('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
  mock.module('../hooks/useShipmentRefundProblems', () => ({
    useShipmentRefundProblems: () => ({ problems: [], count: 0, isLoading: false, isError: false, refetch: async () => undefined }),
    useResolveShipmentRefund: () => ({ resolve: async () => undefined, isPending: false }),
  }));
  mock.module('../components/features/payments/PayoutReleaseWorkbench', () => ({ PayoutReleaseWorkbench: () => null }));
  mock.module('../components/features/payments/PayoutRunsWorkbench', () => ({ PayoutRunsWorkbench: () => null }));
  const { PaymentsPage } = await import('./PaymentsPage');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PayoutReleaseWorkbench } = await import('../components/features/payments/PayoutReleaseWorkbench');
  const { PayoutRunsWorkbench } = await import('../components/features/payments/PayoutRunsWorkbench');
  type Element = React.ReactElement<Record<string, unknown>>;
  const nodes = (value: React.ReactNode): Element[] => Array.isArray(value) ? value.flatMap(nodes)
    : React.isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as React.ReactNode)] : [];
  function harness() {
    let cursor = 0; let refCursor = 0;
    const states: unknown[] = []; const refs: { current: unknown }[] = []; const effects: React.EffectCallback[] = [];
    spyOn(React, 'useState').mockImplementation(((initial: unknown) => {
      const i = cursor++; if (!(i in states)) states[i] = initial;
      return [states[i], (next: unknown) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
    }) as typeof React.useState);
    spyOn(React, 'useRef').mockImplementation(((initial: unknown) => refs[refCursor++] ??= { current: initial }) as typeof React.useRef);
    spyOn(React, 'useLayoutEffect').mockImplementation((effect) => { effects.push(effect); });
    const render = () => { cursor = 0; refCursor = 0; effects.length = 0; const tree = PaymentsPage(); effects.splice(0).forEach((effect) => effect()); return tree; };
    const props = (type: unknown) => nodes(render()).find((node) => node.type === type)!.props;
    const release = () => props(PayoutReleaseWorkbench) as unknown as React.ComponentProps<typeof PayoutReleaseWorkbench>;
    const runs = () => props(PayoutRunsWorkbench) as unknown as React.ComponentProps<typeof PayoutRunsWorkbench>;
    const search = (value: string) => (nodes(render()).find((node) => node.type === 'input')!.props.onChange as (e: unknown) => void)({ target: { value } });
    const attention = () => (nodes(render()).find((node) => node.props.id === 'payments-tab-action-required')!.props.onClick as () => void)();
    return { render, release, runs, search, attention };
  }
  beforeEach(() => { freshBatches = Array.from({ length: 21 }, (_, i) => batch(i)); freshRuns = [run];
    selectionReads = 0; releaseCalls = []; retryCalls = []; selectionError = null; selectionWait = null; serverPage = 0; queryError = false;
    queryLoading = false; pageRevision = 1; queryLastSuccess = null; visibleOverride = null; });
  afterEach(() => mock.restore());
  it('renders the active page last successful query without claiming Stripe synchronization', () => {
    const h = harness();
    expect(renderToStaticMarkup(h.render())).toContain('Sin consulta exitosa todavía.');
    queryLastSuccess = Date.parse('2026-01-01T12:34:56.000Z');
    let markup = renderToStaticMarkup(h.render());
    expect(markup).toContain('Última consulta exitosa de esta página:');
    expect(markup).toMatch(/datetime="2026-01-01T12:34:56\.000Z"/i);
    expect(markup).toContain('No indica sincronización con Stripe.');
    queryError = true;
    markup = renderToStaticMarkup(h.render());
    expect(markup).toMatch(/datetime="2026-01-01T12:34:56\.000Z"/i);
    expect(releaseCalls).toEqual([]); expect(retryCalls).toEqual([]);
  });
  it('explains backend counter units and the current query scope even when filtered', () => {
    const h = harness(); h.search('Ada');
    const markup = renderToStaticMarkup(h.render());
    expect(markup).toContain('Resultados de la búsqueda.');
    expect(markup).toContain('Contadores de la consulta actual, no totales globales:');
    expect(markup).toContain('vendedores en Por liberar; ejecuciones en las demás pestañas.');
    expect(releaseCalls).toEqual([]); expect(retryCalls).toEqual([]);
  });
  it('selects unloaded sellers, preserves deselection across pages and refreshes complete details for dispatch', async () => {
    const h = harness();
    await h.release().onSelectAll!();
    expect(Object.keys(h.release().selectedShipmentsBySeller)).toHaveLength(21);
    expect(releaseCalls).toEqual([]);
    serverPage = 1; h.release().onPageChange!(1);
    expect(h.release().pagination?.page).toBe(1);
    h.release().onToggleShipment('seller-20', 'shipment-20');
    expect(h.release().selectedShipmentsBySeller['seller-20']).toEqual([]);
    h.release().onToggleShipment('seller-20', 'shipment-20');
    await h.release().onRelease('seller-19', { sellerId: 'seller-19', ids: ['shipment-19'], cents: 100, stripeAccountId: 'acct' });
    expect(selectionReads).toBe(2);
    expect(releaseCalls).toHaveLength(1);
    expect(h.release().selectedShipmentsBySeller['seller-19']).toEqual([]);
    expect(h.release().selectedShipmentsBySeller['seller-20']).toEqual(['shipment-20']);
  });
  it('rejects late amount/account/eligibility drift without clearing selected data or calling money', async () => {
    const h = harness(); await h.release().onSelectAll!();
    const expected = { sellerId: 'seller-20', ids: ['shipment-20'], cents: 100, stripeAccountId: 'acct' };
    freshBatches[20] = { ...batch(20), stripeAccountId: 'changed' };
    await expect(h.release().onRelease('seller-20', expected)).rejects.toThrow('cambió');
    freshBatches[20] = { ...batch(20), shipments: [{ ...batch(20).shipments[0], releaseAmountCents: 101 }] };
    await expect(h.release().onRelease('seller-20', expected)).rejects.toThrow('cambió');
    freshBatches = [];
    await expect(h.release().onRelease('seller-20', expected)).rejects.toThrow();
    expect(releaseCalls).toEqual([]);
    expect(h.release().selectedShipmentsBySeller['seller-20']).toEqual(['shipment-20']);
  });
  it('resets search page and selection, applies server clamp, and uses backend group counts', async () => {
    const h = harness(); await h.release().onSelectAll!();
    serverPage = 1; h.release().onPageChange!(1); h.render(); expect(lastOptions.page).toBe(1);
    serverPage = 0; h.render(); h.render(); expect(lastOptions.page).toBe(0);
    h.search('Ada'); h.render(); expect(lastSearch).toBe('Ada'); expect(lastOptions.page).toBe(0);
    expect(h.release().selectedShipmentsBySeller).toEqual({});
    expect(nodes(h.render()).some((node) => node.props['aria-label'] === 'Vendedores en cola: 21')).toBe(true);
  });
  it('rejects failed complete selection without partial installation or money calls', async () => {
    const h = harness(); selectionError = new Error('Incomplete');
    await expect(h.release().onSelectAll!()).rejects.toThrow('Incomplete');
    expect(h.release().selectedShipmentsBySeller).toEqual({}); expect(releaseCalls).toEqual([]);
  });
  it('rejects a completed selection read after its search changed without installing stale selection', async () => {
    const h = harness();
    let complete!: () => void;
    selectionWait = new Promise<void>((resolve) => { complete = resolve; });
    const pending = h.release().onSelectAll!();
    h.search('Other seller'); h.render(); complete();
    await expect(pending).rejects.toThrow('consulta cambió');
    expect(h.release().selectedShipmentsBySeller).toEqual({});
    expect(releaseCalls).toEqual([]); expect(retryCalls).toEqual([]);
  });
  it('rejects delayed release validation superseded by a committed page amount', async () => {
    const h = harness(); await h.release().onSelectAll!();
    let complete!: () => void;
    selectionWait = new Promise<void>((resolve) => { complete = resolve; });
    const pending = h.release().onRelease('seller-0', { sellerId: 'seller-0', ids: ['shipment-0'], cents: 100, stripeAccountId: 'acct' });
    visibleOverride = [{ ...batch(0), shipments: [{ ...batch(0).shipments[0], releaseAmountCents: 101 }] }];
    pageRevision++; h.render(); complete();
    await expect(pending).rejects.toThrow();
    expect(releaseCalls).toEqual([]);
    expect(h.release().selectedShipmentsBySeller['seller-0']).toEqual(['shipment-0']);
  });
  for (const interval of ['error', 'loading', 'success', 'query'] as const) {
    it(`rejects delayed off-page retry validation after recovered ${interval} evidence`, async () => {
      const h = harness(); h.attention(); h.render();
      let complete!: () => void;
      selectionWait = new Promise<void>((resolve) => { complete = resolve; });
      const pending = h.runs().onRetryFailedPayout(run.runId, run);
      if (interval === 'error') { queryError = true; h.render(); queryError = false; }
      if (interval === 'loading') { queryLoading = true; h.render(); queryLoading = false; }
      if (interval === 'success') pageRevision++;
      if (interval === 'query') { h.search('Other'); h.render(); h.search(''); }
      h.render(); complete();
      await expect(pending).rejects.toThrow();
      expect(retryCalls).toEqual([]);
    });
  }
  it('keeps fresh complete Ready details over older visible rows, but reconciles later page drift', async () => {
    const h = harness();
    freshBatches = [{ ...batch(0), shipments: [
      { ...batch(0).shipments[0], releaseAmountCents: 101 },
      { ...batch(0).shipments[0], shipmentId: 'new-eligible', releaseAmountCents: 50 },
    ] }];
    await h.release().onSelectAll!();
    expect(h.release().selectionBatches?.[0].shipments.map((item) => item.releaseAmountCents)).toEqual([101, 50]);
    expect(h.release().selectedShipmentsBySeller['seller-0']).toEqual(['shipment-0', 'new-eligible']);
    expect(releaseCalls).toEqual([]);
    visibleOverride = [{ ...freshBatches[0], stripeAccountId: 'later-account' }];
    pageRevision++;
    expect(h.release().selectionBatches?.[0].stripeAccountId).toBe('later-account');
  });
  it('resolves off-page retry details freshly and rejects late drift/errors before dispatch', async () => {
    const h = harness(); h.attention();
    expect(await h.runs().onSelectAll!()).toEqual([run]); expect(retryCalls).toEqual([]);
    freshRuns = [{ ...run, amountCents: 101 }];
    await expect(h.runs().onRetryFailedPayout(run.runId, run)).rejects.toThrow('cambió');
    freshRuns = [run]; await h.runs().onRetryFailedPayout(run.runId, run);
    expect(retryCalls).toEqual([{ retryRunId: run.runId }]);
    queryError = true; h.render();
    await expect(h.runs().onRetryFailedPayout(run.runId, run)).rejects.toThrow();
    expect(retryCalls).toHaveLength(1);
  });
}
