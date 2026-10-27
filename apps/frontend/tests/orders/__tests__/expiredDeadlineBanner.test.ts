import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const card = read('components/features/orders/OrderActionCard.tsx').replace(/\s+/g, ' ');
const es = JSON.parse(read('core/i18n/locales/es/orders.json'));
const en = JSON.parse(read('core/i18n/locales/en/orders.json'));

// S7: a paid shipment past its shipping window stays cancellable until the
// cron cancels it, so the banner explains it instead of saying "closed".
describe('expired seller deadline banner', () => {
  it('tells the buyer the shipment will be cancelled with a full refund, or they can cancel now', () => {
    expect(es.actionCard.cancellationWindowExpiredBuyer).toBe(
      'El vendedor no envió a tiempo. Este envío se cancelará automáticamente y se te reembolsará por completo, o puedes cancelarlo ahora.',
    );
    expect(en.actionCard.cancellationWindowExpiredBuyer).toBe(
      'The seller did not ship in time. This shipment will be cancelled automatically with a full refund, or you can cancel it now.',
    );
  });

  it('tells the seller the deadline passed and the shipment will be cancelled automatically', () => {
    expect(es.actionCard.cancellationWindowExpiredSeller).toBe(
      'El plazo para enviar venció. Este envío se cancelará automáticamente.',
    );
    expect(en.actionCard.cancellationWindowExpiredSeller).toBe(
      'The shipping deadline has passed. This shipment will be cancelled automatically.',
    );
  });

  it('replaces the old "window closed" message and keeps the open-window message', () => {
    expect(es.actionCard.cancellationWindowClosed).toBeUndefined();
    expect(en.actionCard.cancellationWindowClosed).toBeUndefined();
    expect(card).not.toContain('cancellationWindowClosed');
    expect(card).toContain(
      "return isExpired ? isBuyer ? t('actionCard.cancellationWindowExpiredBuyer') : t('actionCard.cancellationWindowExpiredSeller') : t('actionCard.cancellationWindowOpen', { timeLeft });",
    );
  });

  it('keeps the cancel button gate unchanged', () => {
    const detail = read('app/profile/orders/[id].tsx');
    expect(detail).toContain('currentShipment?.permissions.canCancel && (');
    expect(card).toContain('permissions.canCancel && shipment.created_at && orderExpirationHours != null');
  });
});
