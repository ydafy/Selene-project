import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCancelOrderPayload,
  canBuyerCancelShipment,
  canCancelShipment,
  resolveCancelOrderFailureToast,
  resolveShipmentPreparingWindowMessage,
} from '../apps/frontend/core/utils/shipment-cancel-safety';

import { resolveCancellationSettings } from '../apps/frontend/core/hooks/cancellation-settings';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(ROOT_DIR, '..');

describe('shipment cancel safety frontend helpers', () => {
  it('keeps cancel eligibility buyer-only and paid-only', () => {
    expect(canBuyerCancelShipment({ isBuyer: true, status: 'paid' })).toBe(true);
    expect(canBuyerCancelShipment({ isBuyer: false, status: 'paid' })).toBe(false);
    expect(canBuyerCancelShipment({ isBuyer: true, status: 'shipped' })).toBe(false);
  });

  it('allows seller cancellation only for paid shipments', () => {
    expect(
      canCancelShipment({ isBuyer: false, isSeller: true, status: 'paid' }),
    ).toBe(true);
    expect(
      canCancelShipment({ isBuyer: false, isSeller: true, status: 'preparing' }),
    ).toBe(false);
  });

  it('builds a shipment-scoped cancel payload with the legacy default reason', () => {
    expect(
      buildCancelOrderPayload({
        orderId: '11111111-1111-4111-8111-111111111111',
        shipmentId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toEqual({
      orderId: '11111111-1111-4111-8111-111111111111',
      shipmentId: '22222222-2222-4222-8222-222222222222',
      reason: 'Cancelación solicitada por el usuario',
    });
  });

  it('preserves the live cancellation SLA fallback mapping', () => {
    expect(resolveCancellationSettings(null)).toEqual({
      orderExpirationHours: 48,
      preparingExpirationHours: 72,
    });
  });

  it('preserves the unboxing notice in order detail copy', () => {
    const detail = readFileSync(
      join(REPO_ROOT, 'apps/frontend/app/profile/orders/[id].tsx'),
      'utf8',
    );

    expect(detail).toContain('permissions.showUnboxingWarning');
  });

  it('maps cancel failures to a friendly toast payload', () => {
    expect(resolveCancelOrderFailureToast('MAINTENANCE_MODE')).toEqual({
      title: 'No pudimos cancelar el envío',
      message: 'Estamos haciendo mantenimiento. Intenta nuevamente en unos minutos.',
    });
  });

  it('resolves actor-aware preparing window copy', () => {
    expect(
      resolveShipmentPreparingWindowMessage({
        isBuyer: true,
        isSeller: false,
        timeLeft: '47h',
      }),
    ).toBe(
      'The seller has 47h to ship it. If it does not ship in time, the shipment auto-cancels and your refund is triggered.',
    );

    expect(
      resolveShipmentPreparingWindowMessage({
        isBuyer: false,
        isSeller: true,
        timeLeft: '47h',
      }),
    ).toBe(
      'You have 47h to get a carrier scan. If it does not happen, the shipment auto-cancels.',
    );
  });
});
