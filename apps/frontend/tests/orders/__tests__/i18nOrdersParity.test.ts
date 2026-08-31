import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
type OrdersLocale = {
  summary: Record<string, unknown>;
  notFound: Record<string, unknown>;
  card: Record<string, unknown>;
  actionCard: Record<string, unknown>;
};
const readJson = (locale: string) =>
  JSON.parse(
    readFileSync(join(FRONTEND, `core/i18n/locales/${locale}/orders.json`), 'utf8'),
  ) as OrdersLocale;
const read = (path: string) =>
  readFileSync(join(FRONTEND, path), 'utf8').replace(/\s+/g, ' ');

const expectMatchingKeys = (
  english: Record<string, unknown>,
  spanish: Record<string, unknown>,
) => {
  expect(Object.keys(english).sort()).toEqual(Object.keys(spanish).sort());

  for (const key of Object.keys(english)) {
    const englishValue = english[key];
    const spanishValue = spanish[key];

    if (
      typeof englishValue === 'object' &&
      englishValue !== null &&
      typeof spanishValue === 'object' &&
      spanishValue !== null
    ) {
      expectMatchingKeys(
        englishValue as Record<string, unknown>,
        spanishValue as Record<string, unknown>,
      );
    }
  }
};

describe('role-aware orders localization', () => {
  const en = readJson('en');
  const es = readJson('es');

  it('keeps role-aware summary, not-found, and shipment-count keys in both locales', () => {
    for (const key of ['summary', 'notFound', 'card', 'actionCard'] as const) {
      expect(en[key]).toBeDefined();
      expect(es[key]).toBeDefined();
      expectMatchingKeys(en[key], es[key]);
    }
    expect(en.summary.shipmentCount_one).toBeDefined();
    expect(en.summary.shipmentCount_other).toBeDefined();
    expect(es.summary.shipmentCount_one).toBeDefined();
    expect(es.summary.shipmentCount_other).toBeDefined();
  });

  it('uses translation keys without fallback strings for scoped orders copy', () => {
    const summary = read('app/profile/orders/summary/[id].tsx');
    expect(summary).toContain("t('summary.title')");
    expect(summary).toContain("t('summary.total')");
    expect(summary).toContain("t('summary.items')");
    expect(summary).toContain("t('summary.articles'");
    expect(summary).toContain("t('summary.date')");
    expect(summary).toContain("t('summary.status')");
    expect(summary).not.toContain('defaultValue:');
    expect(read('components/features/orders/ShipmentNotFoundState.tsx')).toContain("t('notFound.title')");
    const card = read('components/features/orders/OrderShipmentCard.tsx');
    expect(card).toContain('const item = shipment.items[0];');
    expect(card).toContain("t('card.unknownProduct')");
    expect(card).toContain("t('card.unknownSeller')");
    expect(card).toContain('t(`card.disputeStatus.${disputeStatus}`)');
    expect(card).toContain("t('actions.managePackage')");
    expect(card).not.toContain('DISPUTE_STATUS_LABELS');
    expect(card).not.toContain('defaultValue:');
  });

  it('uses translation keys for action-card banners and actions', () => {
    const actionCard = read('components/features/orders/OrderActionCard.tsx');
    for (const key of [
      'cancellationWindowTitle',
      'preparingShipmentTitle',
      'deliveredTitle',
      'recordUnboxingTitle',
      'cancellationWindowClosed',
      'cancellationWindowOpen',
      'carrierScanWindowClosed',
      'sellerShippingWindowClosed',
      'reviewWindowClosed',
      'fundsReleaseCountdown',
      'returnPayoutPendingBuyer',
      'returnPayoutPendingSeller',
      'returnLabelPendingBuyer',
      'returnLabelPendingSeller',
      'returnShipmentPendingBuyer',
      'returnShipmentPendingSeller',
      'returnShipmentInTransit',
      'returnDeliveredBuyer',
      'refundProcessedBuyer',
      'refundProcessedSeller',
      'reportReturnProblem',
    ]) {
      expect(actionCard).toContain(`t('actionCard.${key}'`);
    }
    expect(actionCard).not.toContain('CANCELLATION WINDOW');
    expect(actionCard).not.toContain('PREPARING SHIPMENT');
    expect(actionCard).not.toContain('ENTREGA CONFIRMADA');
    expect(actionCard).not.toContain('Reportar Problema con el Retorno');
  });
});
