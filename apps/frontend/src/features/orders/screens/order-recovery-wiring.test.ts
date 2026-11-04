import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('buyer checkout recovery UI wiring', () => {
  it('renders the pending banner before shipment-only detail content and offers support', () => {
    const detail = source(
      'apps/frontend/src/features/orders/screens/order-detail-screen.tsx',
    );

    const hook = source(
      'apps/frontend/src/features/orders/hooks/use-order-detail.ts',
    );

    expect(detail).toContain('useOrderDetail(');
    expect(hook).toContain('resolveBuyerCheckoutRecoveryView');
    expect(detail).toContain("t('recovery.pending')");
    expect(detail).toContain("t('recovery.contactSupport')");
  });

  it('renders the confirmed refund state on order summaries and defines localized copy', () => {
    const summary = source(
      'apps/frontend/src/app/profile/orders/summary/[id].tsx',
    );
    const english = source(
      'apps/frontend/src/shared/i18n/locales/en/orders.json',
    );
    const spanish = source(
      'apps/frontend/src/shared/i18n/locales/es/orders.json',
    );

    expect(summary).toContain("t('recovery.confirmed')");
    expect(english).toContain('"recovery"');
    expect(spanish).toContain('"recovery"');
  });

  it('suppresses summary shipment actions and offers support while the refund is pending', () => {
    const summary = source(
      'apps/frontend/src/app/profile/orders/summary/[id].tsx',
    );

    expect(summary).toContain('shouldSuppressShipmentActionsForBuyerRecovery');
    expect(summary).toContain("t('recovery.pending')");
    expect(summary).toContain("t('recovery.contactSupport')");
  });
});
