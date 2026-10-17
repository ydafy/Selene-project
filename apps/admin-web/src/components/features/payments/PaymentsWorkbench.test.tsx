import { afterAll, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ReleaseQueueBatch,
  ReleaseQueueActionRequiredRun,
} from '../../../lib/connectPayoutReleaseQueue';

if (process.env.PAYMENTS_WORKBENCH_CHILD !== '1') {
  it('verifies page navigation, query isolation and financial callbacks offline in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { ...process.env, PAYMENTS_WORKBENCH_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    console.info(stdout);
    console.info(stderr);
    expect(result.exitCode, stderr).toBe(0);
  });
} else {
  const deniedFetch: typeof fetch = Object.assign(
    () => {
      throw new Error('Unexpected external request');
    },
    {
      preconnect: () => {
        throw new Error('Unexpected external request');
      },
    },
  );
  const fetchGuard = spyOn(globalThis, 'fetch').mockImplementation(deniedFetch);
  afterAll(() => {
    fetchGuard.mockRestore();
    mock.restore();
  });
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
        shipmentId: 'ready-1',
        orderId: 'order-a',
        completedAt: null,
        isEligible: true,
        ineligibleReason: null,
        releaseAmountCents: 12500,
        reconciliationIndicator: 'ready_for_release',
        status: 'completed',
        stripePaymentIntentId: 'pi_a',
      },
      {
        shipmentId: 'blocked-1',
        orderId: 'order-b',
        completedAt: null,
        isEligible: false,
        ineligibleReason: 'NOT_COMPLETED',
        releaseAmountCents: 90000,
        reconciliationIndicator: 'blocked',
        status: 'delivered',
        stripePaymentIntentId: 'pi_b',
      },
    ],
  };
  const run: ReleaseQueueActionRequiredRun = {
    runId: 'run-retry',
    retryOfRunId: null,
    sellerId: 'seller-a',
    sellerName: 'Aurora',
    status: 'failed',
    amountCents: 12500,
    reason: 'retryable_failed',
    canRetry: true,
    failureReason: null,
    failedAt: null,
  };
  let queueError = false;
  let queueLoading = false;
  let earningsError = false;
  let releaseRejects = false;
  const releaseCalls: { batch: ReleaseQueueBatch; shipmentIds: string[] }[] =
    [];
  const retryCalls: { retryRunId: string }[] = [];
  const queueSearches: string[] = [];
  const chargeSearches: string[] = [];
  let queueRefreshes = 0;
  let chargeRefreshes = 0;
  mock.module('../../../hooks/useDebounce', () => ({
    useDebounce: (value: string) => value,
  }));
  mock.module('../../../hooks/useConnectPayoutReleaseQueue', () => ({
    useConnectPayoutReleaseQueue: (search: string) => {
      queueSearches.push(search);
      return {
        batches: [batch],
        processingRuns: [],
        actionRequiredRuns: [run],
        historyRuns: [],
        isLoading: queueLoading,
        isError: queueError,
        isReleasing: false,
        isRetrying: false,
        refetch: async () => {
          queueRefreshes++;
          return { isError: false };
        },
        releaseSelectedShipments: async (input: {
          batch: ReleaseQueueBatch;
          shipmentIds: string[];
        }) => {
          if (releaseRejects) throw new Error('SERVER_REJECTED');
          releaseCalls.push(input);
        },
        retryFailedPayout: async (input: { retryRunId: string }) => {
          retryCalls.push(input);
        },
      };
    },
  }));
  mock.module('../../../hooks/useConnectEarnings', () => ({
    useConnectEarnings: (search: string) => {
      chargeSearches.push(search);
      return {
        data: [
          {
            id: 'charge-1',
            stripe_payment_intent_id: 'pi_buyer',
            seller_name: 'Aurora',
            amount: 25000,
            application_fee_amount: 1000,
            status: 'succeeded',
            created_at: new Date().toISOString(),
          },
        ],
        isLoading: false,
        isFetching: false,
        isError: earningsError,
        refetch: async () => {
          chargeRefreshes++;
          return { isError: false };
        },
      };
    },
  }));
  mock.module('../../../lib/supabase', () => ({
    supabase: {
      functions: {
        invoke: () => {
          throw new Error('Unexpected financial request');
        },
      },
    },
  }));
  mock.module('sonner', () => ({
    toast: { success: () => undefined, error: () => undefined },
  }));
  // Page probes isolate child rendering; each workbench has its own public-control tests.
  mock.module('./PayoutReleaseWorkbench', () => ({
    PayoutReleaseWorkbench: () => (
      <section aria-label="Detalle de liberación">
        Detalle de liberación
      </section>
    ),
  }));
  mock.module('./PayoutRunsWorkbench', () => ({
    PayoutRunsWorkbench: () => (
      <section aria-label="Detalle de dispersión">
        Detalle de dispersión
      </section>
    ),
  }));
  const { PaymentsPage } = await import('../../../pages/PaymentsPage');
  const { PayoutReleaseWorkbench } = await import('./PayoutReleaseWorkbench');
  const { PayoutRunsWorkbench } = await import('./PayoutRunsWorkbench');
  type Element = React.ReactElement<Record<string, unknown>>;
  function nodes(value: React.ReactNode): Element[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!React.isValidElement<Record<string, unknown>>(value)) return [];
    return [value, ...nodes(value.props.children as React.ReactNode)];
  }
  function text(value: React.ReactNode): string {
    if (typeof value === 'string' || typeof value === 'number')
      return String(value);
    if (Array.isArray(value)) return value.map(text).join('');
    return React.isValidElement<Record<string, unknown>>(value)
      ? text(value.props.children as React.ReactNode)
      : '';
  }
  const realUseState = React.useState;
  const realUseMemo = React.useMemo;
  const realUseRef = React.useRef;
  const realUseLayoutEffect = React.useLayoutEffect;
  function harness() {
    const states: unknown[] = [];
    const refs: { current: unknown }[] = [];
    let cursor = 0;
    let refCursor = 0;
    const layoutEffects: React.EffectCallback[] = [];
    const stateSpy = spyOn(React, 'useState').mockImplementation(((
      initial: unknown,
    ) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (next: unknown) => {
          states[index] =
            typeof next === 'function' ? next(states[index]) : next;
        },
      ];
    }) as typeof React.useState);
    const memoSpy = spyOn(React, 'useMemo').mockImplementation(((factory) =>
      factory()) as typeof React.useMemo);
    const refSpy = spyOn(React, 'useRef').mockImplementation(((
      initial: unknown,
    ) => {
      const index = refCursor++;
      refs[index] ??= { current: initial };
      return refs[index];
    }) as typeof React.useRef);
    const layoutSpy = spyOn(React, 'useLayoutEffect').mockImplementation(
      (effect) => {
        layoutEffects.push(effect);
      },
    );
    const render = () => {
      cursor = 0;
      refCursor = 0;
      layoutEffects.length = 0;
      const tree = PaymentsPage();
      // Model committed props before invoking public controls, not a DOM renderer.
      for (const effect of layoutEffects) effect();
      return tree;
    };
    const find = (type: unknown) =>
      nodes(render()).find((node) => node.type === type)!;
    const click = async (label: string) => {
      const button = nodes(render()).find(
        (node) =>
          node.type === 'button' &&
          text(node.props.children as React.ReactNode).startsWith(label),
      );
      expect(button).toBeDefined();
      await (button!.props.onClick as () => unknown)();
    };
    return {
      render,
      find,
      click,
      restore: () => {
        stateSpy.mockRestore();
        memoSpy.mockRestore();
        refSpy.mockRestore();
        layoutSpy.mockRestore();
      },
    };
  }
  function publicHtml() {
    // Use actual React hooks for rendering all descendant components.
    const s = spyOn(React, 'useState').mockImplementation(realUseState);
    const m = spyOn(React, 'useMemo').mockImplementation(realUseMemo);
    const r = spyOn(React, 'useRef').mockImplementation(realUseRef);
    const l = spyOn(React, 'useLayoutEffect').mockImplementation(
      realUseLayoutEffect,
    );
    try {
      return renderToStaticMarkup(<PaymentsPage />);
    } finally {
      s.mockRestore();
      m.mockRestore();
      r.mockRestore();
      l.mockRestore();
    }
  }
  it('has only the shell main landmark when mounted inside the admin layout', () => {
    const html = renderToStaticMarkup(
      <main>
        <PaymentsPage />
      </main>,
    );
    expect(html.match(/<main[ >]/g)?.length).toBe(1);
  });
  it('default page SSR mounts the release inspector without buyer charge data', () => {
    const html = publicHtml();
    expect(html).toContain('aria-label="Detalle de liberación"');
    expect(html).not.toContain('pi_buyer');
    expect(html).not.toContain('Resumen de Tesorería');
  });
  it('release callback sends only currently eligible IDs and clears selection after success', async () => {
    const h = harness();
    try {
      const props = h.find(PayoutReleaseWorkbench).props;
      const toggle = props.onToggleShipment as (
        sellerId: string,
        shipmentId: string,
      ) => void;
      toggle('seller-a', 'ready-1');
      toggle('seller-a', 'blocked-1');
      toggle('seller-a', 'stale');
      await (
        h.find(PayoutReleaseWorkbench).props.onRelease as (
          id: string,
        ) => Promise<void>
      )('seller-a');
      expect(releaseCalls.at(-1)?.shipmentIds).toEqual(['ready-1']);
      expect(
        h.find(PayoutReleaseWorkbench).props.selectedShipmentsBySeller,
      ).toEqual({ 'seller-a': [] });
    } finally {
      h.restore();
    }
  });
  it('a rejected release leaves the selected shipment unchanged and does not record a successful call', async () => {
    const h = harness();
    releaseRejects = true;
    const before = releaseCalls.length;
    try {
      (
        h.find(PayoutReleaseWorkbench).props.onToggleShipment as (
          seller: string,
          id: string,
        ) => void
      )('seller-a', 'ready-1');
      await expect(
        (
          h.find(PayoutReleaseWorkbench).props.onRelease as (
            id: string,
          ) => Promise<void>
        )('seller-a'),
      ).rejects.toThrow('SERVER_REJECTED');
      expect(releaseCalls.length).toBe(before);
      expect(
        h.find(PayoutReleaseWorkbench).props.selectedShipmentsBySeller,
      ).toEqual({ 'seller-a': ['ready-1'] });
    } finally {
      releaseRejects = false;
      h.restore();
    }
  });
  it('retry sends only a run ID and rejects a run absent from the current queue', async () => {
    const h = harness();
    try {
      await h.click('Necesita atención');
      const retry = h.find(PayoutRunsWorkbench).props.onRetryFailedPayout as (
        id: string,
      ) => Promise<void>;
      const before = retryCalls.length;
      await expect(retry('absent')).rejects.toThrow('La cola no permite');
      expect(retryCalls.length).toBe(before);
      await retry('run-retry');
      expect(retryCalls.at(-1)).toEqual({ retryRunId: 'run-retry' });
    } finally {
      h.restore();
    }
  });
  it('removes buyer charge navigation and never subscribes to its legacy feed', () => {
    chargeSearches.length = 0;
    const html = publicHtml();
    expect(html).not.toContain('Cobros de compradores');
    expect(html).not.toContain('Cargos de Compradores');
    expect(chargeSearches).toEqual([]);
    expect(chargeRefreshes).toBe(0);
  });
  it('keeps the single seller search and refresh scoped to the payout queue', async () => {
    const h = harness();
    const refreshesBefore = queueRefreshes;
    try {
      const input = nodes(h.render()).find((node) => node.type === 'input')!;
      (input.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: 'Aurora' },
      });
      h.render();
      expect(queueSearches.at(-1)).toBe('Aurora');
      await h.click('Actualizar consulta');
      await h.click('Necesita atención');
      await h.click('Actualizar consulta');
      expect(queueRefreshes).toBe(refreshesBefore + 2);
      expect(chargeRefreshes).toBe(0);
    } finally {
      h.restore();
    }
  });
  it('places horizontal accessible tabs after the title and before the search', () => {
    const html = publicHtml();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html.indexOf('</h1>')).toBeLessThan(html.indexOf('role="tablist"'));
    expect(html.indexOf('role="tablist"')).toBeLessThan(
      html.indexOf('type="search"'),
    );
    expect(html).not.toContain('lg:flex-col');
  });
  it('locks navigation, search and refresh for the whole batch, not only one request', () => {
    const h = harness();
    try {
      const busy = h.find(PayoutReleaseWorkbench).props.onBusyChange as (
        value: boolean,
      ) => void;
      expect(busy).toBeDefined();
      busy(true);
      const controls = nodes(h.render()).filter(
        (node) => node.type === 'button' || node.type === 'input',
      );
      expect(controls.every((node) => node.props.disabled === true)).toBe(true);
      busy(false);
      expect(
        nodes(h.render()).find((node) => node.type === 'input')?.props.disabled,
      ).toBe(false);
    } finally {
      h.restore();
    }
  });
  it('does not block valid per-seller callbacks just because the batch has locked the workspace', async () => {
    const h = harness();
    try {
      (
        h.find(PayoutReleaseWorkbench).props.onToggleShipment as (
          seller: string,
          shipment: string,
        ) => void
      )('seller-a', 'ready-1');
      (
        h.find(PayoutReleaseWorkbench).props.onBusyChange as (
          value: boolean,
        ) => void
      )(true);
      const before = releaseCalls.length;
      await (
        h.find(PayoutReleaseWorkbench).props.onRelease as (
          seller: string,
        ) => Promise<void>
      )('seller-a');
      expect(releaseCalls.length).toBe(before + 1);
      expect(releaseCalls.at(-1)?.shipmentIds).toEqual(['ready-1']);
    } finally {
      h.restore();
    }
  });
  it('a failed earnings feed does not block the payout workspace', () => {
    earningsError = true;
    try {
      const html = publicHtml();
      expect(html).toContain('Detalle de liberación');
      expect(html).not.toContain('Error al cargar datos financieros');
    } finally {
      earningsError = false;
    }
  });
  it('queue failure preserves the workbench instance but removes its authority and blocks mutations', async () => {
    const h = harness();
    try {
      const before = releaseCalls.length;
      queueError = true;
      const workbench = h.find(PayoutReleaseWorkbench);
      expect(workbench.props.isLoading).toBe(true);
      expect(workbench.props.batches).toEqual([]);
      await expect(
        (workbench.props.onRelease as (id: string) => Promise<void>)(
          'seller-a',
        ),
      ).rejects.toThrow('Espera a que se actualice');
      expect(releaseCalls.length).toBe(before);
    } finally {
      queueError = false;
      h.restore();
    }
  });
  it('keeps the same active retry workbench through loading and query error so outcomes survive', async () => {
    const h = harness();
    try {
      await h.click('Necesita atención');
      const before = h.find(PayoutRunsWorkbench);
      queueLoading = true;
      const loading = h.find(PayoutRunsWorkbench);
      expect(loading.key).toBe(before.key);
      expect(loading.props.isLoading).toBe(true);
      queueError = true;
      const unavailable = h.find(PayoutRunsWorkbench);
      expect(unavailable.key).toBe(before.key);
      expect(unavailable.props.runs).toEqual([]);
      expect(unavailable.props.isLoading).toBe(true);
      const count = retryCalls.length;
      await expect(
        (
          unavailable.props.onRetryFailedPayout as (id: string) => Promise<void>
        )('run-retry'),
      ).rejects.toThrow('La cola no permite');
      expect(retryCalls.length).toBe(count);
    } finally {
      queueError = false;
      queueLoading = false;
      h.restore();
    }
  });
}
