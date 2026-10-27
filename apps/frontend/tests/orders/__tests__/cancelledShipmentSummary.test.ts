import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveCancelledShipmentCopy } from '../../../core/utils/shipment-cancellation-summary';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const compact = (path: string) => read(path).replace(/\s+/g, ' ');
const es = JSON.parse(read('core/i18n/locales/es/orders.json'));
const en = JSON.parse(read('core/i18n/locales/en/orders.json'));

const P = 'orders:actionCard.';

describe('resolveCancelledShipmentCopy', () => {
  it('words the reason by source for the buyer', () => {
    const reason = (source: string) =>
      resolveCancelledShipmentCopy({ source, refundState: 'processing' }, true).reasonKey;
    expect(reason('buyer')).toBe(`${P}cancelReasonBuyerByBuyer`);
    expect(reason('seller')).toBe(`${P}cancelReasonBuyerBySeller`);
    expect(reason('paid_timeout')).toBe(`${P}cancelReasonBuyerPaidTimeout`);
    expect(reason('preparing_timeout')).toBe(`${P}cancelReasonBuyerPreparingTimeout`);
  });

  it('mirrors the reason for the seller', () => {
    const reason = (source: string) =>
      resolveCancelledShipmentCopy({ source, refundState: 'processing' }, false).reasonKey;
    expect(reason('buyer')).toBe(`${P}cancelReasonSellerByBuyer`);
    expect(reason('seller')).toBe(`${P}cancelReasonSellerBySeller`);
    expect(reason('paid_timeout')).toBe(`${P}cancelReasonSellerPaidTimeout`);
    expect(reason('preparing_timeout')).toBe(`${P}cancelReasonSellerPreparingTimeout`);
  });

  it('describes the refund state for the buyer', () => {
    const detail = (refundState: string) =>
      resolveCancelledShipmentCopy({ source: 'buyer', refundState }, true).messageKey;
    expect(detail('processing')).toBe(`${P}cancelledRefundProcessing`);
    expect(detail('refunded')).toBe(`${P}cancelledRefundIssued`);
    expect(detail('delayed')).toBe(`${P}cancelledRefundDelayed`);
  });

  it('keeps the seller message independent of the refund state', () => {
    for (const refundState of ['processing', 'refunded', 'delayed']) {
      expect(
        resolveCancelledShipmentCopy({ source: 'buyer', refundState }, false).messageKey,
      ).toBe(`${P}cancelledSeller`);
    }
  });

  it('falls back to today\'s banner without a summary or with unknown values', () => {
    expect(resolveCancelledShipmentCopy(null, true)).toEqual({
      reasonKey: null,
      messageKey: `${P}cancelledBuyer`,
    });
    expect(resolveCancelledShipmentCopy(null, false)).toEqual({
      reasonKey: null,
      messageKey: `${P}cancelledSeller`,
    });
    expect(
      resolveCancelledShipmentCopy({ source: 'new', refundState: 'new' }, true),
    ).toEqual({ reasonKey: null, messageKey: `${P}cancelledBuyer` });
  });

  it('only has keys that exist in both locales', () => {
    const keys = new Set<string>();
    for (const source of ['buyer', 'seller', 'paid_timeout', 'preparing_timeout']) {
      for (const refundState of ['processing', 'refunded', 'delayed']) {
        for (const isBuyer of [true, false]) {
          const r = resolveCancelledShipmentCopy({ source, refundState }, isBuyer);
          if (r.reasonKey) keys.add(r.reasonKey);
          keys.add(r.messageKey);
        }
      }
    }
    for (const key of keys) {
      const name = key.replace(P, '');
      expect(typeof es.actionCard[name]).toBe('string');
      expect(typeof en.actionCard[name]).toBe('string');
    }
  });

  it('never tells the buyer the money already arrived', () => {
    expect(es.actionCard.cancelledRefundIssued).toContain('5 y 10 días hábiles');
    expect(en.actionCard.cancelledRefundIssued).toContain('5 to 10 business days');
  });
});

describe('cancellation summary hook wiring', () => {
  const hook = compact('core/hooks/useShipmentCancellationSummary.ts');

  it('calls the RPC only for a cancelled shipment, keyed by shipment and viewer', () => {
    expect(hook).toContain("supabase.rpc( 'fn_get_shipment_cancellation_summary'");
    expect(hook).toContain("queryKey: ['shipment-cancellation-summary', shipmentId, userId]");
    expect(hook).toContain("enabled: !!shipmentId && !!userId && status === 'cancelled'");
  });

  it('treats no row as no summary', () => {
    expect(hook).toContain('data?.[0] ?? null');
  });

  it('is refreshed after a cancellation', () => {
    const logic = read('core/hooks/useOrderActions.logic.ts');
    expect(logic).toContain("['shipment-cancellation-summary']");
  });
});

describe('banner wiring', () => {
  const card = compact('components/features/orders/OrderActionCard.tsx');

  it('reads the summary for the shipment and resolves the copy by role', () => {
    expect(card).toContain('useShipmentCancellationSummary(shipment.id, shipment.status)');
    expect(card).toContain('resolveCancelledShipmentCopy(cancellationSummary, isBuyer)');
  });
});
