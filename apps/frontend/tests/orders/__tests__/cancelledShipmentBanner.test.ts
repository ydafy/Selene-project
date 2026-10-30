import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const card = read('components/features/orders/OrderActionCard.tsx').replace(/\s+/g, ' ');
const es = JSON.parse(read('core/i18n/locales/es/orders.json'));
const en = JSON.parse(read('core/i18n/locales/en/orders.json'));

// Native rendering needs Expo dependencies, absent in this worktree. These
// guards verify localized copy and shipment-scoped wiring.
describe('cancelled shipment banner', () => {
  it('tells the seller their product is back in their store', () => {
    expect(es.actionCard.cancelledSeller).toBe(
      'Este envío fue cancelado y tu producto volvió a tu tienda: ya está disponible para venderse de nuevo. El comprador recibe su reembolso; tú no tienes que hacer nada.',
    );
    expect(en.actionCard.cancelledSeller).toBe(
      'This shipment was cancelled and your product is back in your store: it is available to sell again. The buyer gets their refund; you do not need to do anything.',
    );
  });

  it('shows the banner for a cancelled shipment whatever the order status is (#62)', () => {
    expect(card).toMatch(
      /const isCancelledShipment =\s*resolveOrderBannerKind\(\{[^}]*shipmentStatus: shipment\.status,?\s*\}\) === 'cancelledShipment';/,
    );
    expect(card).not.toContain("order.status !== 'dispute'");
    expect(card).toMatch(/isCriticalStatus \|\|\s*isCancelledShipment \|\|/);
  });

  it('titles and words the banner by the shipment and the viewer role', () => {
    expect(card).toContain(
      "if (isCancelledShipment) return t('orders:status.cancelled').toUpperCase();",
    );
    expect(card).toContain(
      'if (isCancelledShipment) { return t(cancelledCopy.messageKey); }',
    );
  });

  it('keeps the buyer cancellation copy unchanged', () => {
    expect(es.actionCard.cancelledBuyer).toBe(
      'Tu envío fue cancelado. El reembolso se procesa al método de pago original. Una vez confirmado, tu banco puede tardar entre 5 y 10 días hábiles en reflejarlo.',
    );
  });
});
