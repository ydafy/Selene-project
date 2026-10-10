import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveSummaryState, summaryAmounts } from '../../../core/utils/order-summary-state';

const ready = { hasOrder: true, orderPending: false, orderError: false, hasShipments: true, shipmentsPending: false, shipmentsError: false };

describe('summary initial data policy', () => {
  it('waits for initial order and required shipments', () => {
    expect(resolveSummaryState({ ...ready, hasOrder: false, orderPending: true })).toBe('loading');
    expect(resolveSummaryState({ ...ready, hasShipments: false, shipmentsPending: true })).toBe('loading');
  });
  it('terminates on order error or absence', () => {
    expect(resolveSummaryState({ ...ready, hasOrder: false, orderError: true, shipmentsPending: true })).toBe('error');
    expect(resolveSummaryState({ ...ready, hasOrder: false })).toBe('missing');
  });
  it('never treats failed required shipments as empty success', () => {
    expect(resolveSummaryState({ ...ready, hasShipments: false, shipmentsError: true })).toBe('error');
    expect(resolveSummaryState({ ...ready, hasShipments: false })).toBe('error');
  });
  it('preserves cached order and shipments during refresh errors or pending', () => {
    expect(resolveSummaryState({ ...ready, orderError: true, shipmentsError: true })).toBe('ready');
    expect(resolveSummaryState({ ...ready, orderPending: true, shipmentsPending: true })).toBe('ready');
  });
});

describe('saved summary amounts', () => {
  const items = [{ price_at_purchase: 0.1 }, { price_at_purchase: 0.2 }, { price_at_purchase: 19.99 }];
  it('sums saved prices in cents and keeps persisted buyer total', () => {
    expect(summaryAmounts('buyer', items, 24.56)).toEqual({ subtotalCents: 2029, totalPaidCents: 2456 });
  });
  it('seller only gets their supplied visible items, never buyer total', () => {
    expect(summaryAmounts('seller', items.slice(2), 24.56)).toEqual({ subtotalCents: 1999, totalPaidCents: null });
    expect(summaryAmounts('seller', [], 24.56).subtotalCents).toBe(0);
  });
  it('screen wires policy, amounts, localized retry and buyer-only total', () => {
    const source = readFileSync(`${import.meta.dir}/../../../app/profile/orders/summary/[id].tsx`, 'utf8');
    expect(source).toContain('resolveSummaryState(');
    expect(source).toContain('summaryAmounts(view.role, visibleShipments.flatMap');
    expect(source).toContain("t('summary.subtotal')");
    expect(source).toContain("t('summary.totalPaid')");
    expect(source).toContain("t('summary.retry')");
    expect(source).toContain("{view.role === 'buyer' && (");
    expect(source).not.toContain('isAnyLoading || !order');
  });
});
