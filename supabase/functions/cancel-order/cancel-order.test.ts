import { describe, expect, it } from 'bun:test';

import {
  ApiError,
  buildCancelShipmentRefundParams,
  parseCancelOrderRequestBody,
  resolveManualShipmentCancelPlan,
} from './cancel-order';
import { computeShipmentRefundAmountCents } from '../_shared/refund-basis';

describe('parseCancelOrderRequestBody', () => {
  it('requires shipmentId and applies the default cancel reason', () => {
    expect(
      parseCancelOrderRequestBody({
        orderId: '11111111-1111-4111-8111-111111111111',
        shipmentId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toEqual({
      orderId: '11111111-1111-4111-8111-111111111111',
      shipmentId: '22222222-2222-4222-8222-222222222222',
      reason: 'Cancelación solicitada por el usuario',
    });
  });

  it('rejects a manual request without shipment scope', () => {
    expect(() =>
      parseCancelOrderRequestBody({
        orderId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow();
  });
});

describe('computeShipmentRefundAmountCents', () => {
  it('excludes seller-paid shipping and keeps the buyer-paid fee in the refund basis', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderChargeCents: 362_900,
      }),
    ).toBe(362_900);
  });

  it('reconciles a multi-shipment refund basis without seller shipping', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: [{ price_at_purchase: 3_000, shipping_amount: 110 }],
        orderItems: [
          { price_at_purchase: 3_000, shipping_amount: 110 },
          { price_at_purchase: 2_000, shipping_amount: 75 },
        ],
        orderChargeCents: 510_000,
      }),
    ).toBe(306_000);
  });
});

describe('buildCancelShipmentRefundParams', () => {
  it('builds a shipment-only refund payload without reverse_transfer', () => {
    const { params, options } = buildCancelShipmentRefundParams({
      paymentIntentId: 'pi_123',
      amountCents: 21_700,
      orderId: '11111111-1111-4111-8111-111111111111',
      shipmentId: '22222222-2222-4222-8222-222222222222',
      callerRole: 'buyer',
      reason: 'Cancelación solicitada por el usuario',
      seguroShareCents: 1_700,
    });

    expect(params).toEqual({
      payment_intent: 'pi_123',
      amount: 21_700,
      reason: 'requested_by_customer',
        metadata: {
          shipment_id: '22222222-2222-4222-8222-222222222222',
          order_id: '11111111-1111-4111-8111-111111111111',
          caller_role: 'buyer',
          reason: 'Cancelación solicitada por el usuario',
          seguro_share_cents: 1_700,
        },
      });
    expect(params).not.toHaveProperty('reverse_transfer');
    expect(options).toEqual({
      idempotencyKey: 'cancel_shipment_22222222-2222-4222-8222-222222222222',
    });
  });
});

describe('resolveManualShipmentCancelPlan', () => {
  it('supports sequential shipment cancellations without exceeding the actual fee', () => {
    const orderItems = [
      { price_at_purchase: 3_000, shipping_amount: 110, shipment_id: 'shipment-a' },
      { price_at_purchase: 2_000, shipping_amount: 75, shipment_id: 'shipment-b' },
    ];
    const baseInput = {
      isMaintenance: false,
      callerRole: 'buyer' as const,
      callerId: 'buyer-1',
      orderId: 'order-1',
      orderBuyerId: 'buyer-1',
      shipmentSellerId: 'seller-1',
      shipmentOrderId: 'order-1',
      shipmentStatus: 'paid',
      shipmentStripePaymentIntentId: 'pi_123',
      shipmentStripeTransferId: null,
      orderItems,
      orderChargeCents: 510_000,
      actualStripeFeeCents: 18_000,
      reason: 'Cancelled',
    };

    const first = resolveManualShipmentCancelPlan({
      ...baseInput,
      shipmentId: 'shipment-a',
      shipmentItems: [orderItems[0]],
      remainingRefundableCents: 510_000,
    });
    const second = resolveManualShipmentCancelPlan({
      ...baseInput,
      shipmentId: 'shipment-b',
      shipmentItems: [orderItems[1]],
      remainingRefundableCents: 204_000,
    });

    expect(first.amountCents).toBe(306_000);
    expect(second.amountCents).toBe(204_000);
    expect(
      first.rpcInput.p_cancellation_loss_cents! +
        second.rpcInput.p_cancellation_loss_cents!,
    ).toBe(18_000);
  });

  it('builds a seller refund plan for a paid shipment', () => {
    expect(
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'seller',
        callerId: 'seller-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderChargeCents: 1_050_000,
        actualStripeFeeCents: 20_000,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toEqual({
      amountCents: 1_050_000,
      refundParams: {
        params: {
          payment_intent: 'pi_123',
          amount: 1_050_000,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: '22222222-2222-4222-8222-222222222222',
            order_id: '11111111-1111-4111-8111-111111111111',
            caller_role: 'seller',
            reason: 'Cancelación solicitada por el usuario',
            seguro_share_cents: 50_000,
          },
        },
        options: {
          idempotencyKey: 'cancel_shipment_22222222-2222-4222-8222-222222222222',
        },
      },
      rpcInput: {
        p_shipment_id: '22222222-2222-4222-8222-222222222222',
        p_cancelled_by_role: 'seller',
        p_reason: 'Cancelación solicitada por el usuario',
        p_cancellation_loss_cents: 20_000,
      },
    });
  });

  it('rejects seller cancellation while a shipment is preparing', () => {
    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'seller',
        callerId: 'seller-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'preparing',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderChargeCents: 1_050_000,
        actualStripeFeeCents: null,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toThrow(ApiError);
  });

  it('rejects a shipment that belongs to a different order', () => {
    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '33333333-3333-4333-8333-333333333333',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderChargeCents: 1_050_000,
        reason: 'Cancelación solicitada por el usuario',
        actualStripeFeeCents: null,
      }),
    ).toThrow(ApiError);
  });

  it('halts maintenance mode before any critical callback or refund plan is built', () => {
    const criticalCalls: Array<Record<string, unknown>> = [];

    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: true,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderChargeCents: 1_050_000,
        reason: 'Cancelación solicitada por el usuario',
        onCritical: (message, metadata) => {
          criticalCalls.push({ message, ...metadata });
        },
      }),
    ).toThrow(ApiError);

    expect(criticalCalls).toEqual([]);
  });

  it('rejects maintenance mode before any refund plan is produced', () => {
    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: true,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderChargeCents: 1_050_000,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toThrow(ApiError);
  });

  it('rejects a shipped shipment or a shipment with a released transfer', () => {
    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'shipped',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderChargeCents: 1_050_000,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toThrow(ApiError);

    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: 'tr_123',
        shipmentItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderItems: [{ price_at_purchase: 10_000, shipping_amount: 1_000 }],
        orderChargeCents: 1_050_000,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toThrow(ApiError);
  });

  it('builds a buyer-only refund plan for a paid shipment', () => {
    expect(
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderChargeCents: 362_900,
        actualStripeFeeCents: null,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toEqual({
      amountCents: 362_900,
      refundParams: {
        params: {
          payment_intent: 'pi_123',
          amount: 362_900,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: '22222222-2222-4222-8222-222222222222',
            order_id: '11111111-1111-4111-8111-111111111111',
            caller_role: 'buyer',
            reason: 'Cancelación solicitada por el usuario',
            seguro_share_cents: 12_900,
          },
        },
        options: {
          idempotencyKey: 'cancel_shipment_22222222-2222-4222-8222-222222222222',
        },
      },
      rpcInput: {
        p_shipment_id: '22222222-2222-4222-8222-222222222222',
        p_cancelled_by_role: 'buyer',
        p_reason: 'Cancelación solicitada por el usuario',
        p_cancellation_loss_cents: null,
      },
    });
  });

  it('rejects a zero-amount refund before any Stripe payload is built', () => {
    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [],
        orderItems: [],
        orderChargeCents: 0,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toThrow(ApiError);
  });

  it('rejects refunds that exceed the remaining charge cap before Stripe is called', () => {
    expect(() =>
      resolveManualShipmentCancelPlan({
        isMaintenance: false,
        callerRole: 'buyer',
        callerId: 'buyer-1',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderBuyerId: 'buyer-1',
        shipmentSellerId: 'seller-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        shipmentOrderId: '11111111-1111-4111-8111-111111111111',
        shipmentStatus: 'paid',
        shipmentStripePaymentIntentId: 'pi_123',
        shipmentStripeTransferId: null,
        shipmentItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderChargeCents: 362_900,
        remainingRefundableCents: 362_800,
        reason: 'Cancelación solicitada por el usuario',
      }),
    ).toThrow(ApiError);
  });
});
