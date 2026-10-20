import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { orderCardAmountCents } from '../../../core/utils/order-summary-state';

const card = readFileSync(
  `${import.meta.dir}/../../../components/features/orders/OrderCard.tsx`,
  'utf8',
).replace(/\s+/g, ' ');

describe('order card amount by role', () => {
  const sellerItems = [{ price_at_purchase: 0.1 }, { price_at_purchase: 19.99 }];

  it('shows the seller only the sum of their own items, never the buyer total', () => {
    expect(orderCardAmountCents('seller', sellerItems, 124.56)).toBe(2009);
  });

  it('shows the seller zero when no own items are loaded', () => {
    expect(orderCardAmountCents('seller', [], 124.56)).toBe(0);
  });

  it('keeps the persisted order total for the buyer', () => {
    expect(orderCardAmountCents('buyer', sellerItems, 124.56)).toBe(12456);
  });

  it('wires the card price through the role-aware amount', () => {
    expect(card).toContain(
      "orderCardAmountCents( isSeller ? 'seller' : 'buyer', order.items, order.total_amount, )",
    );
    expect(card).toContain('formatCurrency(cardAmountCents / 100)');
    expect(card).not.toContain('formatCurrency(order.total_amount)');
  });
});

describe('order detail total by role', () => {
  const detail = readFileSync(
    `${import.meta.dir}/../../../app/profile/orders/[id].tsx`,
    'utf8',
  ).replace(/\s+/g, ' ');
  const es = JSON.parse(
    readFileSync(`${import.meta.dir}/../../../core/i18n/locales/es/orders.json`, 'utf8'),
  );
  const en = JSON.parse(
    readFileSync(`${import.meta.dir}/../../../core/i18n/locales/en/orders.json`, 'utf8'),
  );

  it('shows the seller their shipment subtotal even on single-seller orders', () => {
    expect(detail).toContain(
      'const displayedTotal = isMultiShipment || currentShipment?.isSeller ? shipmentSubtotal : (order?.total_amount ?? 0);',
    );
  });

  it('labels the seller total as sold and keeps the buyer paid label', () => {
    expect(detail).toContain(
      "{currentShipment?.isSeller ? t('orders:detail.totalSold') : t('orders:detail.total')}",
    );
    expect(es.detail.total).toBe('Total pagado');
    expect(en.detail.total).toBe('Total Paid');
    expect(es.detail.totalSold).toBe('Total vendido');
    expect(en.detail.totalSold).toBe('Total Sold');
  });
});
