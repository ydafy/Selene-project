import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { resolveOrderBannerKind } from '../orderActionBanner';

const card = readFileSync(new URL('../OrderActionCard.tsx', import.meta.url), 'utf8').replace(
  /\s+/g,
  ' ',
);
const message = card.slice(card.indexOf('const getBannerMessage'));

describe('cancelled shipment banner precedence (S4)', () => {
  for (const orderStatus of ['dispute', 'refunded', 'cancelled', 'paid'] as const) {
    test(`cancelled shipment in a ${orderStatus} order shows the cancelled banner`, () => {
      expect(resolveOrderBannerKind({ orderStatus, shipmentStatus: 'cancelled' })).toBe(
        'cancelledShipment',
      );
    });
  }

  test('the component checks the cancelled shipment before the order-level dispute and refund copy', () => {
    const cancelled = message.indexOf('if (isCancelledShipment) { return t(cancelledCopy.messageKey); }');
    expect(cancelled).toBeGreaterThan(-1);
    expect(cancelled).toBeLessThan(message.indexOf("if (order.status === 'dispute')"));
    expect(cancelled).toBeLessThan(message.indexOf("if (order.status === 'refunded')"));
  });
});

describe('existing banners stay unchanged', () => {
  test('non-cancelled shipment in a dispute order keeps the dispute banner', () => {
    expect(resolveOrderBannerKind({ orderStatus: 'dispute', shipmentStatus: 'paid' })).toBe(
      'dispute',
    );
    expect(message).toContain("t('orders:detail.disputeMsgSeller')");
    expect(message).toContain("t('orders:detail.disputeMsgBuyer')");
    expect(message).toContain("t('actionCard.returnShipmentInTransit')");
  });

  test('non-cancelled shipment in a refunded order keeps the refund copy', () => {
    expect(resolveOrderBannerKind({ orderStatus: 'refunded', shipmentStatus: 'paid' })).toBe(
      'refunded',
    );
    expect(message).toContain(
      "if (order.status === 'refunded') { return isBuyer ? t('actionCard.refundProcessedBuyer') : t('actionCard.refundProcessedSeller'); }",
    );
  });

  test('other order statuses keep the generic order-status copy', () => {
    expect(resolveOrderBannerKind({ orderStatus: 'paid', shipmentStatus: 'paid' })).toBe(
      'orderStatus',
    );
    expect(resolveOrderBannerKind({ orderStatus: null, shipmentStatus: 'paid' })).toBe(
      'orderStatus',
    );
    expect(message).toContain('return t(`orders:detail.${order.status}Msg`);');
  });
});
