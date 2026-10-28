import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveCancelledShipmentCopy } from '../../../core/utils/shipment-cancellation-summary';
import { canShowSellerLabelActions } from '../../../core/utils/shipment-label-visibility';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const es = JSON.parse(read('core/i18n/locales/es/orders.json'));
const en = JSON.parse(read('core/i18n/locales/en/orders.json'));

describe('canShowSellerLabelActions', () => {
  const show = (status: string, isSeller = true, labelUrl: string | null = 'https://x/l.pdf') =>
    canShowSellerLabelActions({ isSeller, status, labelUrl });

  it('shows the live label while the shipment is open', () => {
    expect(show('paid')).toBe(true);
    expect(show('preparing')).toBe(true);
    expect(show('shipped')).toBe(true);
  });

  it('never shows a label for a cancelled shipment', () => {
    expect(show('cancelled')).toBe(false);
  });

  it('requires a seller and a label', () => {
    expect(show('preparing', false)).toBe(false);
    expect(show('preparing', true, null)).toBe(false);
    expect(show('preparing', true, '')).toBe(false);
  });
});

describe('cancelled banner label notice', () => {
  const summary = { source: 'preparing_timeout', refundState: 'processing' };

  it('adds the invalid-label line for the seller only when a label existed', () => {
    expect(resolveCancelledShipmentCopy(summary, false, true).labelNoticeKey).toBe(
      'orders:actionCard.cancelledLabelInvalidSeller',
    );
    expect(resolveCancelledShipmentCopy(summary, false, false).labelNoticeKey).toBeNull();
    expect(resolveCancelledShipmentCopy(null, false, true).labelNoticeKey).toBe(
      'orders:actionCard.cancelledLabelInvalidSeller',
    );
  });

  it('leaves the buyer copy unchanged', () => {
    expect(resolveCancelledShipmentCopy(summary, true, true).labelNoticeKey).toBeNull();
    expect(resolveCancelledShipmentCopy(summary, true).labelNoticeKey).toBeNull();
  });

  it('has the exact en and es copy', () => {
    expect(es.actionCard.cancelledLabelInvalidSeller).toBe(
      'La guía ya no es válida: no lleves el paquete a la paquetería.',
    );
    expect(en.actionCard.cancelledLabelInvalidSeller).toBe(
      'The label is no longer valid: do not take the package to the carrier.',
    );
  });
});

describe('screen wiring', () => {
  const screen = read('app/profile/orders/[id].tsx').replace(/\s+/g, ' ');
  const card = read('components/features/orders/OrderActionCard.tsx').replace(/\s+/g, ' ');
  const hook = read('core/hooks/useShipments.ts').replace(/\s+/g, ' ');

  it('gates the label buttons with the visibility helper', () => {
    expect(screen).toContain('canShowSellerLabelActions({');
  });

  it('renders the label notice in the banner', () => {
    expect(card).toContain('cancelledCopy.labelNoticeKey');
    expect(card).toContain('Boolean(shipment.label_url)');
  });

  it('keeps shipping instructions off cancelled shipments', () => {
    expect(hook).toContain("['paid', 'preparing'].includes(shipment.status)");
  });
});
