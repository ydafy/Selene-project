import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const detail = read('src/features/orders/screens/order-detail-screen.tsx');
const flatDetail = detail.replace(/\s+/g, ' ');
const hook = read('src/features/orders/hooks/use-order-detail-actions.ts');
const flatHook = hook.replace(/\s+/g, ' ');
const handlerText = (name: string) => {
  const start = hook.indexOf(`const ${name} = async () => {`);
  return hook.slice(start, hook.indexOf('\n  };\n', start));
};
const dialogs = read('src/features/orders/components/order-detail-dialogs.tsx');
const es = JSON.parse(read('src/shared/i18n/locales/es/orders.json'));
const en = JSON.parse(read('src/shared/i18n/locales/en/orders.json'));

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
      'const isSellerCancel = currentShipment?.isSeller ?? false;',
    );
    expect(detail).toContain('useOrderDetailActions({');
    expect(flatDetail).toContain('isSellerCancel, t, });');
    expect(flatHook).toContain("text1: t('orders:dialogs.cancelSuccessTitle')");
  });

  it('keeps the cancel handler guard, call and dialog wiring', () => {
    const handler = handlerText('handleCancelOrder');
    expect(handler).toContain('if (!currentShipment) {');
    expect(handler).toContain('setShowCancelConfirm(false);');
    expect(handler).toContain('actions.cancelOrder.execute({');
    expect(handler).toContain('shipmentId: currentShipment.id');
    expect(handler.replace(/\s+/g, ' ')).toContain(
      "await actions.cancelOrder.execute({ shipmentId: currentShipment.id, }); setShowCancelConfirm(false); await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); Toast.show({ type: 'info',",
    );
    expect(detail).toContain('useOrderDetailActions(');
    expect(detail).toContain('onConfirmCancel={handleCancelOrder}');
    expect(detail).toContain(
      'onDismissCancel={() => setShowCancelConfirm(false)}',
    );
  });

  it('drops the buyer-only disclaimer and hardcoded toast fallbacks', () => {
    expect(detail).not.toContain('orders:detail.cancelDisclaimer');
    expect(detail).not.toContain("'orders:dialogs.cancelSuccessMsg'");
    expect(hook).not.toContain('orders:detail.cancelDisclaimer');
    expect(hook).not.toContain("'orders:dialogs.cancelSuccessMsg'");
    expect(es.detail.cancelDisclaimer).toBeUndefined();
    expect(en.detail.cancelDisclaimer).toBeUndefined();
  });

  it('keeps the shared cancel title and confirm action', () => {
    expect(detail).toContain('<OrderDetailDialogs');
    expect(dialogs).toContain("title={t('orders:dialogs.cancelTitle')}");
    expect(dialogs).toContain(
      "confirmLabel={t('orders:actions.confirmCancel')}",
    );
    expect(es.dialogs.cancelTitle).toBe('¿Deseas cancelar este envío?');
    expect(en.dialogs.cancelTitle).toBe('Do you want to cancel this shipment?');
    expect(es.actions.cancelOrder).toBe('Cancelar envío');
    expect(en.actions.cancelOrder).toBe('Cancel shipment');
    expect(es.actions.confirmCancel).toBe('Sí, cancelar envío');
    expect(en.actions.confirmCancel).toBe('Yes, cancel shipment');
  });

  it('adds the other-shipments note only when the order has several shipments', () => {
    expect(detail).toContain(
      'const isMultiShipment = (order?.shipments?.length ?? 0) > 1;',
    );
    expect(flatHook).toContain(
      "const withOtherShipmentsNote = (message: string) => isMultiShipment ? `${message} ${t('orders:dialogs.otherShipmentsContinue')}` : message;",
    );
    expect(detail).toContain('<OrderDetailDialogs');
    expect(flatDetail).toContain(
      "cancelDescription={withOtherShipmentsNote( t( isSellerCancel ? 'orders:dialogs.cancelMsgSeller' : 'orders:dialogs.cancelMsgBuyer', ), )}",
    );
    expect(dialogs).toContain('description={cancelDescription}');
    expect(flatHook).toContain(
      "text2: withOtherShipmentsNote( t( isSellerCancel ? 'orders:dialogs.cancelSuccessMsgSeller' : 'orders:dialogs.cancelSuccessMsgBuyer', ), )",
    );
  });
});
