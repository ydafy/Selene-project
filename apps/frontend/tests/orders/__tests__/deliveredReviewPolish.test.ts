import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const card = read('components/features/orders/OrderActionCard.tsx');
const flatCard = card.replace(/\s+/g, ' ');
const detail = read('app/profile/orders/[id].tsx');
const es = JSON.parse(read('core/i18n/locales/es/orders.json'));
const en = JSON.parse(read('core/i18n/locales/en/orders.json'));

// Native rendering needs Expo dependencies, absent in this worktree. These
// guards verify localized copy and wiring, not layout or device interactions.
describe('delivered review polish', () => {
  it('separates seller status, review countdown, and payment explanation', () => {
    expect(es.actionCard.deliveredTitle).toBe('Paquete entregado');
    expect(es.actionCard.deliveredReviewMessage).toBe(
      'El comprador puede confirmar antes de que termine el plazo. Si no reporta un problema, la compra se completará automáticamente. Después, Selene gestionará tu pago.',
    );
    expect(es.actionCard.sellerReviewCountdown).toBe(
      'Tiempo de revisión restante: {{timeLeft}}',
    );
    expect(es.actionCard.deliveredReviewMessage).not.toContain('{{timeLeft}}');
    expect(flatCard).toContain(
      "const showSellerDeliveredBanner = permissions.showSellerDeliveredBanner && isSeller && shipment.status === 'delivered' && !dispute;",
    );
    expect(flatCard).toContain('{showSellerStatusBanner && ( <PrimaryButton');
    expect(flatCard).toContain(
      'visible={showSellerStatusBanner && isPaymentExplanationVisible}',
    );
    expect(card).toContain('<SellerPaymentExplanation />');
  });

  it('does not let order-level fallback permissions override the selected shipment', () => {
    expect(flatCard).toContain(
      "const showSellerDeliveredBanner = permissions.showSellerDeliveredBanner && isSeller && shipment.status === 'delivered' && !dispute;",
    );
    expect(flatCard).toContain(
      "const showSellerCompletedBanner = isSeller && shipment.status === 'completed' && !dispute;",
    );
  });

  it('shows the buyer review instructions and a shipment-scoped countdown', () => {
    expect(es.actionCard.buyerDeliveredTitle).toBe('Revisa tu producto');
    expect(es.actionCard.buyerDeliveredMessage).toBe(
      'Comprueba que recibiste el producto correcto y que funciona antes de confirmar.',
    );
    expect(es.actionCard.buyerReviewCountdown).toBe(
      'Tiempo para reportar un problema: {{timeLeft}}',
    );
    expect(flatCard).toContain(
      "const showBuyerDeliveredBanner = isBuyer && shipment.status === 'delivered' && !dispute;",
    );
    expect(card).toContain("t('actionCard.buyerDeliveredTitle')");
    expect(card).toContain("t('actionCard.buyerDeliveredMessage')");
    expect(flatCard).toContain(
      'showSellerStatusBanner || showBuyerDeliveredBanner || permissions.canCancel',
    );
    expect(flatCard).toContain(
      'showDeliveredReviewBanner && shipment.delivered_at',
    );
    expect(flatCard).toContain('return { startTime: shipment.delivered_at, limit: 48 };');
    expect(card).not.toContain('startTime: order.delivered_at');
  });

  it('uses neutral expired copy without claiming payout processing or an active window', () => {
    expect(es.actionCard.reviewWindowClosed).toBe(
      'El plazo de revisión terminó. La compra está pendiente de actualizarse.',
    );
    expect(flatCard).toContain(
      "if (showDeliveredReviewBanner && isExpired) { return t('actionCard.reviewWindowClosed'); }",
    );
    expect(flatCard).toContain(
      '{showDeliveredReviewBanner && timerConfig && !isExpired && (',
    );
    expect(card).toContain("t('actionCard.sellerReviewCountdown', { timeLeft })");
    expect(card).toContain("t('actionCard.buyerReviewCountdown', { timeLeft })");
  });

  it('does not invent a review deadline when the delivery timestamp is missing or invalid', () => {
    expect(flatCard).toContain(
      'showDeliveredReviewBanner && shipment.delivered_at && Number.isFinite(new Date(shipment.delivered_at).getTime())',
    );
    expect(flatCard).toContain(
      '{showDeliveredReviewBanner && timerConfig && !isExpired && (',
    );
  });

  it('shortens the buyer dialog while stating completion and how to report a problem', () => {
    expect(es.dialogs.deliveryTitle).toBe('¿Recibiste y revisaste tu producto?');
    expect(es.dialogs.deliveryMsg).toBe(
      'Al confirmar, la compra se completa. Si el producto no es el correcto o no funciona, no confirmes: reporta un problema.',
    );
    expect(es.dialogs.deliveryConfirm).toBe('Sí, confirmar');
    expect(es.dialogs.deliveryCancel).toBe('Volver');
    const dialog = detail.slice(
      detail.indexOf('visible={showDeliveryConfirm}'),
      detail.indexOf('<ReviewModal'),
    );
    expect(dialog).toContain("confirmLabel={t('orders:dialogs.deliveryConfirm')}");
    expect(dialog).toContain("cancelLabel={t('orders:dialogs.deliveryCancel')}");
    expect(dialog).toContain('onConfirm={handleConfirmDelivery}');
    expect(dialog).toContain('loading={actions.confirmDelivery.isLoading}');
    const handler = detail.slice(
      detail.indexOf('const handleConfirmDelivery = async () => {'),
      detail.indexOf('visible={showDeliveryConfirm}'),
    );
    expect(handler).toContain('actions.confirmDelivery.execute({');
    expect(handler).toContain('shipmentId: currentShipment.id');
  });

  it('keeps equivalent English copy and interpolation without bank-arrival promises', () => {
    const keys = [
      'buyerDeliveredTitle', 'buyerDeliveredMessage', 'sellerReviewCountdown',
      'buyerReviewCountdown', 'deliveredReviewMessage', 'reviewWindowClosed',
    ];
    for (const key of keys) {
      expect(en.actionCard[key]).toBeString();
      expect(es.actionCard[key]).toBeString();
      expect(en.actionCard[key].match(/{{[^}]+}}/g) ?? []).toEqual(
        es.actionCard[key].match(/{{[^}]+}}/g) ?? [],
      );
    }
    expect(en.dialogs.deliveryTitle).toBe('Did you receive and check your product?');
    expect(en.dialogs.deliveryMsg).toBe(
      'Confirming completes the purchase. If the product is incorrect or does not work, do not confirm: report a problem.',
    );
    expect(en.dialogs.deliveryConfirm).toBe('Yes, confirm');
    expect(en.dialogs.deliveryCancel).toBe('Go back');
    expect(en.actionCard.reviewWindowClosed).toBe(
      'The review window has ended. The purchase is awaiting a status update.',
    );
  });

  it('preserves cancellation, preparing, return-dispute, and completed seller paths', () => {
    expect(flatCard).toContain(
      'permissions.canCancel && shipment.created_at && orderExpirationHours != null',
    );
    expect(flatCard).toContain(
      "shipment.status === 'preparing' && shipment.updated_at && preparingExpirationHours != null",
    );
    expect(card).toContain('resolveShipmentPreparingWindowMessage({');
    expect(card).toContain("t('actionCard.returnPayoutPendingBuyer', { timeLeft })");
    expect(card).toContain("t('actionCard.returnPayoutPendingSeller', { timeLeft })");
    expect(card).toContain("t('actionCard.completedMessage')");
    expect(flatCard).toContain(
      "const showSellerCompletedBanner = isSeller && shipment.status === 'completed' && !dispute;",
    );
  });
});
