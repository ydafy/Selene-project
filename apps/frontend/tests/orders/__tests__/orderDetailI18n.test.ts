import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const detail = read('app/profile/orders/[id].tsx');
const flat = detail.replace(/\s+/g, ' ');
const es = JSON.parse(read('core/i18n/locales/es/orders.json'));
const en = JSON.parse(read('core/i18n/locales/en/orders.json'));

describe('order detail delivery confirmation toast', () => {
  it('never claims the seller was already paid', () => {
    expect(es.dialogs.deliverySuccessTitle).toBe('¡Entrega confirmada!');
    expect(es.dialogs.deliverySuccessMsg).toBe(
      'Gracias por tu compra. Selene gestionará el pago al vendedor.',
    );
    expect(en.dialogs.deliverySuccessTitle).toBe('Delivery confirmed!');
    expect(en.dialogs.deliverySuccessMsg).toBe(
      "Thanks for your purchase. Selene will handle the seller's payment.",
    );
    expect(detail).not.toContain('Los fondos han sido liberados');
  });

  it('drops the orphaned detail copy that promised an automatic 48-hour release', () => {
    expect(es.detail.deliverySuccessMsg).toBeUndefined();
    expect(es.detail.deliverySuccessTitle).toBeUndefined();
    expect(en.detail.deliverySuccessMsg).toBeUndefined();
    expect(en.detail.deliverySuccessTitle).toBeUndefined();
  });
});

describe('order detail copy is fully localized', () => {
  it('uses translation keys without Spanish fallbacks', () => {
    expect(detail).not.toContain('defaultValue');
    expect(detail).not.toContain("'Resumen de tu venta'");
    expect(detail).not.toContain('"Error al guardar"');
    expect(detail).not.toContain('"Reintentar"');
    expect(detail).not.toContain('"Cerrar"');
  });

  it('titles the summary by role', () => {
    expect(flat).toContain(
      "order.isSeller ? t('orders:detail.subTitleSeller') : t('orders:detail.subTitle')",
    );
    expect(es.detail.subTitleSeller).toBe('Resumen de tu venta');
    expect(en.detail.subTitleSeller).toBe('Your Sale Summary');
  });

  it('shows a translated review error instead of the raw error message', () => {
    expect(flat).toContain("setReviewError(t('orders:dialogs.reviewErrorMsg'))");
    expect(detail).not.toContain('e instanceof Error ? e.message');
    expect(es.dialogs.reviewErrorTitle).toBe('No pudimos actualizar');
    expect(es.dialogs.reviewErrorMsg).toBe(
      'Tu calificación se guardó, pero no pudimos actualizar la pantalla. Intenta de nuevo.',
    );
    expect(es.dialogs.reviewErrorRetry).toBe('Reintentar');
    expect(es.dialogs.reviewErrorClose).toBe('Cerrar');
    expect(en.dialogs.reviewErrorTitle).toBe('Could not refresh');
    expect(en.dialogs.reviewErrorMsg).toBe(
      'Your rating was saved, but we could not refresh the screen. Please try again.',
    );
    expect(en.dialogs.reviewErrorRetry).toBe('Retry');
    expect(en.dialogs.reviewErrorClose).toBe('Close');
  });

  it('defines every previously missing key in both locales', () => {
    const keys: [string, string, string][] = [
      ['actions.shareTitle', 'Guía de envío - Selene', 'Shipping label - Selene'],
      ['actions.shareMessage', 'Guía de envío para imprimir: {{url}}', 'Shipping label to print: {{url}}'],
      ['actions.printHint', '💡 ¿No tienes impresora? Compártela para imprimirla en tu papelería más cercana.', '💡 No printer? Share it to print at your nearest print shop.'],
      ['actions.rateProductHint', 'Abre el formulario para calificar este producto', 'Opens the form to rate this product'],
      ['detail.multiSellerTitle', 'Esta orden tiene {{count}} vendedores', 'This order has {{count}} sellers'],
      ['detail.items_one', 'producto', 'product'],
      ['detail.items_other', 'productos', 'products'],
      ['detail.viewShipment', 'Ver envío', 'View shipment'],
      ['detail.viewShippingSummary', 'Ver resumen de envíos', 'View shipping summary'],
      ['detail.returnTrackingTitle', 'Rastreo de retorno', 'Return tracking'],
      ['detail.noItems', 'No hay productos disponibles.', 'No products available.'],
    ];
    const get = (o: Record<string, unknown>, path: string) =>
      path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], o);
    for (const [key, esValue, enValue] of keys) {
      expect([key, get(es, key)]).toEqual([key, esValue]);
      expect([key, get(en, key)]).toEqual([key, enValue]);
    }
  });
});
