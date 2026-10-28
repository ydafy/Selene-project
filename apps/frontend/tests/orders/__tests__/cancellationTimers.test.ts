import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(FRONTEND, path), 'utf8').replace(/\s+/g, ' ');
const card = read('components/features/orders/OrderActionCard.tsx');
const actions = read('core/hooks/useOrderActions.ts');
const settings = read('core/hooks/cancellation-settings.ts');

describe('cancellation timers without invented deadlines', () => {
  it('has no 48/72 fallback in the settings resolver', () => {
    expect(settings).not.toContain('FALLBACK');
    expect(settings).not.toMatch(/\b(48|72)\b/);
  });

  it('starts the paid and preparing countdowns only when their setting exists', () => {
    expect(card).toContain('shipment.created_at && orderExpirationHours != null');
    expect(card).toContain('shipment.updated_at && preparingExpirationHours != null');
  });

  it('shows no time message while the setting is missing', () => {
    expect(card).toContain(
      '(permissions.canCancel && orderExpirationHours == null) || (shipment.status === \'preparing\' && preparingExpirationHours == null)',
    );
  });

  it('keeps the 48h review and return windows, which are not system settings', () => {
    expect(card).toContain('startTime: shipment.delivered_at, limit: 48');
    expect(card).toContain('startTime: dispute.updated_at, limit: 48');
  });
});

describe('other order mutations keep their refresh', () => {
  it('confirmDelivery still refreshes order, purchases and shipments', () => {
    const block = actions.slice(actions.indexOf('const confirmDelivery'), actions.indexOf('const cancelOrder'));
    expect(block).toContain("['order', orderId]");
    expect(block).toContain("['my-purchases']");
    expect(block).toContain("['shipments', orderId]");
    expect(block).not.toContain('my-listings');
  });

  it('generateLabel still refreshes order, sales and shipments', () => {
    const block = actions.slice(actions.indexOf('const generateLabel'), actions.indexOf('const confirmDelivery'));
    expect(block).toContain("['my-sales']");
    expect(block).toContain("['shipments', orderId]");
  });
});
