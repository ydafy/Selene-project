import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildShipmentConfirmationPayload,
  canConfirmShipmentDelivery,
  resolveShipmentConfirmationFailureToast,
} from '../../core/utils/shipment-confirmation';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('shipment confirmation', () => {
  it('allows only buyers to confirm delivered shipments without an active dispute', () => {
    expect(
      canConfirmShipmentDelivery({
        isBuyer: true,
        status: 'delivered',
        activeDispute: false,
      }),
    ).toBe(true);
    expect(
      canConfirmShipmentDelivery({
        isBuyer: true,
        status: 'shipped',
        activeDispute: false,
      }),
    ).toBe(false);
    expect(
      canConfirmShipmentDelivery({
        isBuyer: true,
        status: 'delivered',
        activeDispute: true,
      }),
    ).toBe(false);
    expect(
      canConfirmShipmentDelivery({
        isBuyer: false,
        status: 'delivered',
        activeDispute: false,
      }),
    ).toBe(false);
  });

  it('blocks only unresolved dispute statuses and permits resolved or rejected disputes', () => {
    const shipments = source('apps/frontend/core/hooks/useShipments.ts');
    const activeStatuses = shipments
      .match(/const ACTIVE_DISPUTE_STATUSES[^=]*=\s*\[([\s\S]*?)\];/)?.[1]
      .match(/'[^']+'/g);

    expect(activeStatuses).toEqual([
      "'open'",
      "'under_review'",
      "'waiting_return'",
      "'return_shipped'",
      "'return_delivered'",
    ]);
    expect(shipments).toContain('ACTIVE_DISPUTE_STATUSES.includes(dispute.status)');
    expect(shipments).not.toContain('const activeDispute = isDispute;');

    expect(
      canConfirmShipmentDelivery({
        isBuyer: true,
        status: 'delivered',
        activeDispute: true,
      }),
    ).toBe(false);
    expect(
      canConfirmShipmentDelivery({
        isBuyer: true,
        status: 'delivered',
        activeDispute: false,
      }),
    ).toBe(true);
  });

  it('builds a shipment-scoped idempotency key and maps confirmation failures', () => {
    expect(
      buildShipmentConfirmationPayload({
        orderId: 'order-1',
        shipmentId: 'shipment-1',
      }),
    ).toEqual({
      orderId: 'order-1',
      shipmentId: 'shipment-1',
      idempotencyKey: 'confirm_shipment_shipment-1',
    });
    expect(
      buildShipmentConfirmationPayload({
        orderId: 'order-1',
        shipmentId: 'shipment-2',
      }).idempotencyKey,
    ).toBe('confirm_shipment_shipment-2');
    expect(
      resolveShipmentConfirmationFailureToast(new Error('ACTIVE_DISPUTE')),
    ).toEqual({
      title: 'No pudimos confirmar la entrega',
      message: 'Este envío tiene una disputa activa.',
    });
    expect(
      resolveShipmentConfirmationFailureToast(new Error('MAINTENANCE_MODE')),
    ).toEqual({
      title: 'No pudimos confirmar la entrega',
      message: 'Estamos haciendo mantenimiento. Intenta nuevamente en unos minutos.',
    });
  });

  it('routes confirmation through the shipment Edge Function without the retired fallback', () => {
    const actions = source('apps/frontend/core/hooks/useOrderActions.ts');
    const shipments = source('apps/frontend/core/hooks/useShipments.ts');

    expect(actions).toContain("invokeEdge('confirm-shipment-delivery'");
    expect(actions).toContain('buildShipmentConfirmationPayload');
    expect(actions).not.toContain('fn_confirm_delivery');
    expect(shipments).toContain('canConfirmShipmentDelivery');
  });

  it('uses delivered-only copy that does not promise an immediate payout', () => {
    const detail = source('apps/frontend/app/profile/orders/[id].tsx');
    const english = JSON.parse(
      source('apps/frontend/core/i18n/locales/en/orders.json'),
    );
    const spanish = JSON.parse(
      source('apps/frontend/core/i18n/locales/es/orders.json'),
    );

    expect(detail).toContain("t('orders:dialogs.deliveryMsg')");
    expect(english.actions.confirmDelivery).toBe('Confirm Delivered Package');
    expect(english.dialogs.deliveryMsg).toContain('after the carrier marks');
    expect(english.dialogs.deliveryMsg).toContain('admin process');
    expect(spanish.actions.confirmDelivery).toBe('Confirmar paquete entregado');
    expect(spanish.dialogs.deliveryMsg).toContain('después de que la paquetería');
    expect(spanish.dialogs.deliveryMsg).toContain('proceso administrativo');
  });
});
