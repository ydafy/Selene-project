import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const detail = read('app/profile/orders/[id].tsx');
const flatDetail = detail.replace(/\s+/g, ' ');
const es = JSON.parse(read('core/i18n/locales/es/orders.json'));
const en = JSON.parse(read('core/i18n/locales/en/orders.json'));

// Native rendering needs Expo dependencies, absent in this worktree. These
// guards verify localized copy and role wiring, not device interactions.
describe('cancel dialog role copy', () => {
  it('provides role-specific cancel copy in Spanish', () => {
    expect(es.dialogs.cancelMsgBuyer).toBe(
      'Recibirás un reembolso completo de este envío a tu método de pago original. Solo puedes cancelar antes de que el vendedor prepare el envío.',
    );
    expect(es.dialogs.cancelMsgSeller).toBe(
      'El comprador recibirá un reembolso completo de este envío y los productos de este envío volverán a estar disponibles. Solo puedes cancelar antes de preparar el envío.',
    );
    expect(es.dialogs.cancelSuccessTitle).toBe('Envío cancelado');
    expect(es.dialogs.cancelSuccessMsgBuyer).toBe(
      'Tu reembolso de este envío será procesado a tu método de pago original.',
    );
    expect(es.dialogs.cancelSuccessMsgSeller).toBe(
      'El comprador recibirá el reembolso de este envío y tus productos vuelven a estar disponibles.',
    );
    expect(es.dialogs.otherShipmentsContinue).toBe(
      'Los demás envíos del pedido continúan con normalidad.',
    );
  });

  it('provides role-specific cancel copy in English', () => {
    expect(en.dialogs.cancelMsgBuyer).toBe(
      'You will receive a full refund of this shipment to your original payment method. You can only cancel before the seller prepares the shipment.',
    );
    expect(en.dialogs.cancelMsgSeller).toBe(
      'The buyer will receive a full refund of this shipment and the products in this shipment will be available again. You can only cancel before preparing the shipment.',
    );
    expect(en.dialogs.cancelSuccessTitle).toBe('Shipment cancelled');
    expect(en.dialogs.cancelSuccessMsgBuyer).toBe(
      'Your refund for this shipment will be processed to your original payment method.',
    );
    expect(en.dialogs.cancelSuccessMsgSeller).toBe(
      'The buyer will receive the refund for this shipment and your products are available again.',
    );
    expect(en.dialogs.otherShipmentsContinue).toBe(
      'The other shipments of the order continue as normal.',
    );
  });

  it('selects dialog and toast copy by the selected shipment role', () => {
    expect(flatDetail).toContain(
      "const isSellerCancel = currentShipment?.isSeller ?? false;",
    );
    expect(flatDetail).toContain("text1: t('orders:dialogs.cancelSuccessTitle')");
  });

  it('drops the buyer-only disclaimer and hardcoded toast fallbacks', () => {
    expect(detail).not.toContain('orders:detail.cancelDisclaimer');
    expect(detail).not.toContain("'orders:dialogs.cancelSuccessMsg'");
    expect(es.detail.cancelDisclaimer).toBeUndefined();
    expect(en.detail.cancelDisclaimer).toBeUndefined();
  });

  it('keeps the shared cancel title and confirm action', () => {
    expect(detail).toContain("title={t('orders:dialogs.cancelTitle')}");
    expect(detail).toContain("confirmLabel={t('orders:actions.confirmCancel')}");
    expect(es.dialogs.cancelTitle).toBe('¿Deseas cancelar este envío?');
    expect(en.dialogs.cancelTitle).toBe('Do you want to cancel this shipment?');
    expect(es.actions.cancelOrder).toBe('Cancelar envío');
    expect(en.actions.cancelOrder).toBe('Cancel shipment');
    expect(es.actions.confirmCancel).toBe('Sí, cancelar envío');
    expect(en.actions.confirmCancel).toBe('Yes, cancel shipment');
  });

  it('adds the other-shipments note only when the order has several shipments', () => {
    expect(detail).toContain('const isMultiShipment = (order?.shipments?.length ?? 0) > 1;');
    expect(flatDetail).toContain(
      "const withOtherShipmentsNote = (message: string) => isMultiShipment ? `${message} ${t('orders:dialogs.otherShipmentsContinue')}` : message;",
    );
    expect(flatDetail).toContain(
      "description={withOtherShipmentsNote( t( isSellerCancel ? 'orders:dialogs.cancelMsgSeller' : 'orders:dialogs.cancelMsgBuyer', ), )}",
    );
    expect(flatDetail).toContain(
      "text2: withOtherShipmentsNote( t( isSellerCancel ? 'orders:dialogs.cancelSuccessMsgSeller' : 'orders:dialogs.cancelSuccessMsgBuyer', ), )",
    );
  });
});
