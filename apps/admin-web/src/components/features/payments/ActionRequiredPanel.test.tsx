import { afterAll, afterEach, beforeEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Module mocks never escape this subprocess into other test files.
if (process.env.B24_PANEL_CHILD !== '1') {
  it('renders the action-required chips in an isolated SSR process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B24_PANEL_CHILD: '1' },
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

  const problem = {
    shipmentId: 'aaaaaaaa-1111', orderId: 'bbbbbbbb-2222', buyerId: 'buyer-1', shipmentStatus: 'paid',
    kind: 'refund_ambiguous', refundId: null, refundFailureReason: null, amountOwedCents: 5000,
    paymentIntentId: 'pi_1', since: '2026-10-22T10:00:00.000Z',
  };
  let refunds: Record<string, unknown>;
  mock.module('../../../hooks/useShipmentRefundProblems', () => ({
    useShipmentRefundProblems: () => refunds,
    useResolveShipmentRefund: () => ({ resolve: async () => undefined, isPending: false }),
  }));
  mock.module('../../../lib/supabase', () => ({ supabase: {
    functions: { invoke: () => { throw new Error('Unexpected external request'); } },
  } }));
  const { ActionRequiredPanel } = await import('./ActionRequiredPanel');
  const realUseState = React.useState;

  const payouts = <p>EXISTING-PAYOUT-CONTENT</p>;
  function render(view: 'payouts' | 'refunds', payoutCount = 3) {
    const state = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
      realUseState(initial === 'payouts' ? view : initial)
    ) as typeof React.useState);
    try {
      return renderToStaticMarkup(<ActionRequiredPanel payoutCount={payoutCount}>{payouts}</ActionRequiredPanel>);
    } finally {
      state.mockRestore();
    }
  }
  beforeEach(() => {
    refunds = { problems: [problem], count: 1, isLoading: false, isError: false, refetch: async () => undefined };
  });
  afterEach(() => mock.restore());

  it('shows both chips with their counts and Dispersiones selected by default', () => {
    refunds = { ...refunds, count: 4 };
    const html = render('payouts', 7);
    expect(html).toContain('Dispersiones (7)');
    expect(html).toContain('Reembolsos (4)');
    expect(html).toMatch(/aria-pressed="true"[^>]*>[^<]*Dispersiones/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>[^<]*Reembolsos/);
  });

  it('leaves the Dispersiones content untouched and keeps refund rows out of it', () => {
    const html = render('payouts');
    expect(html).toContain('EXISTING-PAYOUT-CONTENT');
    expect(html).not.toContain('Reembolso ambiguo');
  });

  it('shows the refunds count while Dispersiones is selected, and a placeholder while unknown', () => {
    expect(render('payouts')).toContain('Reembolsos (1)');
    refunds = { ...refunds, count: null, isLoading: true };
    expect(render('payouts')).toContain('Reembolsos (—)');
    refunds = { ...refunds, count: null, isLoading: false, isError: true };
    expect(render('payouts')).toContain('Reembolsos (—)');
  });

  it('shows only the refunds bucket when Reembolsos is selected', () => {
    const html = render('refunds');
    expect(html).toContain('Reembolso ambiguo');
    expect(html).not.toContain('EXISTING-PAYOUT-CONTENT');
    expect(html).toMatch(/aria-pressed="true"[^>]*>[^<]*Reembolsos/);
  });

  it('does not claim empty refunds while loading', () => {
    refunds = { ...refunds, problems: [], count: null, isLoading: true };
    const html = render('refunds');
    expect(html).not.toContain('Ningún reembolso pendiente');
    expect(html).toContain('Consultando reembolsos');
  });
}
