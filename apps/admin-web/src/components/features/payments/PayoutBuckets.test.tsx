import { afterAll, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PaymentTab } from '../../../pages/PaymentsPage';
import type { ConnectPayoutReleaseQueueRow } from '@selene/types';
import { mapConnectPayoutReleaseQueue } from '../../../lib/connectPayoutReleaseQueue';

// Module mocks never escape this subprocess into other test files.
if (process.env.A65_SSR_CHILD !== '1') {
  it('renders the actual PaymentsPage run buckets in an isolated SSR process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { A65_SSR_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const offlineFetch: typeof fetch = Object.assign(() => {
    throw new Error('Unexpected external request');
  }, {
    preconnect: () => { throw new Error('Unexpected external preconnect'); },
  });
  const denyFetch = spyOn(globalThis, 'fetch').mockImplementation(offlineFetch);
  afterAll(() => denyFetch.mockRestore());
  let loading = true;
  let queueError = false;
  let populated = false;
  const row: ConnectPayoutReleaseQueueRow = {
    completed_at: null, ineligible_reason: null, is_eligible: false, is_retryable: false,
    order_id: 'order-1', payout_run_amount_cents: 12500, payout_run_failed_at: null,
    payout_run_failure_reason: null, payout_run_id: 'run-1', payout_run_status: 'paid',
    release_amount_cents: 12500, requires_manual_review: false, retry_of_run_id: null,
    seller_id: 'seller-1', seller_name: 'SSR Seller', shipment_id: 'shipment-1',
    status: 'completed', stripe_account_id: 'acct_123', stripe_onboarding_status: 'complete',
    stripe_payment_intent_id: 'pi_123', stripe_transfer_id: null, transfer_group: null,
  };
  const mapped = mapConnectPayoutReleaseQueue([
    { ...row, payout_run_status: 'pending_reconciliation', payout_run_id: 'run-processing' },
    { ...row, payout_run_status: 'failed', payout_run_id: 'run-failed' },
    row,
  ]);
  mock.module('../../../hooks/useConnectEarnings', () => ({
    useConnectEarnings: () => ({ data: [], isLoading: false, isFetching: false,
      isError: false, refetch: async () => undefined }),
  }));
  mock.module('../../../hooks/useConnectPayoutReleaseQueue', () => ({
    useConnectPayoutReleaseQueue: () => ({ batches: [],
      processingRuns: populated ? mapped.processingRuns : [],
      actionRequiredRuns: populated ? mapped.actionRequiredRuns : [],
      historyRuns: populated ? mapped.historyRuns : [], isLoading: loading, isError: queueError,
      refetch: async () => undefined, isReleasing: false, isRetrying: false,
      releaseSelectedShipments: () => { throw new Error('Unexpected financial mutation'); },
      retryFailedPayout: () => { throw new Error('Unexpected financial mutation'); } }),
  }));
  // No actual client module/environment loading or external requests.
  mock.module('../../../lib/supabase', () => ({ supabase: {
    functions: { invoke: () => { throw new Error('Unexpected external request'); } },
  } }));
  const { PaymentsPage } = await import('../../../pages/PaymentsPage');
  const realUseState = React.useState;
  function renderTab(tab: PaymentTab, search = '') {
    // Seed SSR state, not browser clicks; retain real React state handling and
    // restore immediately even if rendering throws. Isolation adds a second fence.
    const state = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
      realUseState(initial === 'ready' ? tab : initial === '' ? search : initial)
    ) as typeof React.useState);
    try {
      return renderToStaticMarkup(<PaymentsPage />);
    } finally {
      state.mockRestore();
    }
  }
  const cases = [
    ['processing', 'No hay dispersiones en proceso', 'run-processing'],
    ['action-required', 'Nada requiere atención', 'run-failed'],
    ['history', 'Sin dispersiones pagadas todavía', 'run-1'],
  ] as const;
  for (const [tab, empty, runId] of cases) {
    it(`${tab}: unresolved queue does not claim empty`, () => {
      loading = true;
      const html = renderTab(tab);
      expect(html).not.toContain(empty);
      expect(html).toContain('Consultando cola de dispersión en Stripe Connect...');
    });
    it(`${tab}: a new unresolved search does not claim empty`, () => {
      loading = true;
      expect(renderTab(tab, 'new seller')).not.toContain(empty);
    });
    it(`${tab}: loading gates populated run content too`, () => {
      loading = true;
      populated = true;
      try {
        const html = renderTab(tab);
        expect(html).toContain('Consultando cola de dispersión en Stripe Connect...');
        expect(html).not.toContain(runId);
      } finally { populated = false; }
    });
    it(`${tab}: resolved empty queue retains existing empty presentation`, () => {
      loading = false;
      expect(renderTab(tab)).toContain(empty);
    });
    it(`${tab}: resolved nonempty queue renders the existing run component`, () => {
      loading = false;
      populated = true;
      try {
        const html = renderTab(tab);
        expect(html).toContain(runId);
        expect(html).toContain('SSR Seller');
        expect(html).not.toContain(empty);
        expect(html).not.toContain('Consultando cola de dispersión en Stripe Connect...');
      } finally { populated = false; }
    });
  }
  it('retains the shared page error guard for a queue failure', () => {
    queueError = true;
    loading = false;
    try {
      const html = renderTab('history');
      expect(html).toContain('Error al cargar datos financieros');
      expect(html).not.toContain('Sin dispersiones pagadas todavía');
    } finally { queueError = false; }
  });
}
