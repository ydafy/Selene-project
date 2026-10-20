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
      'Recibirás un reembolso completo a tu método de pago original. Solo puedes cancelar antes de que el vendedor prepare el envío.',
    );
    expect(es.dialogs.cancelMsgSeller).toBe(
      'El comprador recibirá un reembolso completo y tus productos volverán a estar disponibles. Solo puedes cancelar antes de preparar el envío.',
    );
    expect(es.dialogs.cancelSuccessTitle).toBe('Pedido cancelado');
    expect(es.dialogs.cancelSuccessMsgBuyer).toBe(
      'Tu reembolso será procesado a tu método de pago original.',
    );
    expect(es.dialogs.cancelSuccessMsgSeller).toBe(
      'El comprador recibirá su reembolso y tus productos vuelven a estar disponibles.',
    );
  });

  it('provides role-specific cancel copy in English', () => {
    expect(en.dialogs.cancelMsgBuyer).toBe(
      'You will receive a full refund to your original payment method. You can only cancel before the seller prepares the shipment.',
    );
    expect(en.dialogs.cancelMsgSeller).toBe(
      'The buyer will receive a full refund and your products will be available again. You can only cancel before preparing the shipment.',
    );
    expect(en.dialogs.cancelSuccessTitle).toBe('Order cancelled');
    expect(en.dialogs.cancelSuccessMsgBuyer).toBe(
      'Your refund will be processed to your original payment method.',
    );
    expect(en.dialogs.cancelSuccessMsgSeller).toBe(
      'The buyer will receive their refund and your products are available again.',
    );
  });

  it('selects dialog and toast copy by the selected shipment role', () => {
    expect(flatDetail).toContain(
      "const isSellerCancel = currentShipment?.isSeller ?? false;",
    );
    expect(flatDetail).toContain(
      "description={t( isSellerCancel ? 'orders:dialogs.cancelMsgSeller' : 'orders:dialogs.cancelMsgBuyer', )}",
    );
    expect(flatDetail).toContain("text1: t('orders:dialogs.cancelSuccessTitle')");
    expect(flatDetail).toContain(
      "text2: t( isSellerCancel ? 'orders:dialogs.cancelSuccessMsgSeller' : 'orders:dialogs.cancelSuccessMsgBuyer', )",
    );
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
    expect(es.dialogs.cancelTitle).toBe('¿Deseas cancelar este pedido?');
    expect(en.dialogs.cancelTitle).toBe('Do you want to cancel this order?');
  });
});
