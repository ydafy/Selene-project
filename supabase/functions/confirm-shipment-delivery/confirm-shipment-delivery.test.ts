import { describe, expect, it } from 'bun:test';

import {
  ApiError,
  buildConfirmationDiagnostic,
  mapConfirmationRpcResult,
  parseConfirmationRequestBody,
  resolveBuyerConfirmationPlan,
} from './confirm-shipment-delivery';
import {
	deriveOrderGroupId,
	deriveShipmentId,
} from '../create-connect-payment/single-payment-builder.ts';

const orderId = '11111111-1111-4111-8111-111111111111';
const shipmentId = '22222222-2222-4222-8222-222222222222';
const buyerId = '33333333-3333-4333-8333-333333333333';

const validRequest = {
  orderId,
  shipmentId,
  idempotencyKey: `confirm_shipment_${shipmentId}`,
};

const validContext = {
  isMaintenance: false,
  actorId: buyerId,
  order: { id: orderId, buyer_id: buyerId },
  shipment: { id: shipmentId, order_id: orderId, status: 'delivered' },
  hasActiveDispute: false,
};

describe('parseConfirmationRequestBody', () => {
	it('accepts real UUID v5 identifiers produced by create-connect-payment', () => {
		const producerOrderId = deriveOrderGroupId('confirmation-contract-key');
		const producerShipmentId = deriveShipmentId(
			'confirmation-contract-key',
			'product_gpu',
		);
		const request = parseConfirmationRequestBody({
			orderId: producerOrderId,
			shipmentId: producerShipmentId,
			idempotencyKey: `confirm_shipment_${producerShipmentId}`,
		});

		expect(request).toEqual({
			orderId: producerOrderId,
			shipmentId: producerShipmentId,
			idempotencyKey: `confirm_shipment_${producerShipmentId}`,
		});
		expect(
			resolveBuyerConfirmationPlan({
				...validContext,
				order: { id: producerOrderId, buyer_id: buyerId },
				shipment: {
					id: producerShipmentId,
					order_id: producerOrderId,
					status: 'delivered',
				},
			}),
		).toMatchObject({ p_shipment_id: producerShipmentId });
	});

	it('accepts UUID-scoped confirmation with its deterministic idempotency key', () => {
    expect(parseConfirmationRequestBody(validRequest)).toEqual(validRequest);
  });

  it('rejects malformed identifiers and a key for another shipment', () => {
    expect(() =>
      parseConfirmationRequestBody({ ...validRequest, orderId: 'order-1' }),
    ).toThrow(new ApiError(400, 'INVALID_REQUEST'));
    expect(() =>
      parseConfirmationRequestBody({
        ...validRequest,
        idempotencyKey: 'confirm_shipment_44444444-4444-4444-8444-444444444444',
      }),
    ).toThrow(new ApiError(400, 'INVALID_REQUEST'));
  });
});

describe('resolveBuyerConfirmationPlan', () => {
  it('requires authentication before server-authoritative shipment access', () => {
    expect(() =>
      resolveBuyerConfirmationPlan({ ...validContext, actorId: null }),
    ).toThrow(new ApiError(401, 'AUTH_REQUIRED'));
  });

  it('halts confirmation during maintenance before constructing the RPC input', () => {
    expect(() =>
      resolveBuyerConfirmationPlan({ ...validContext, isMaintenance: true }),
    ).toThrow(new ApiError(503, 'MAINTENANCE_MODE'));
  });

  it('rejects a caller who is not the server-derived order buyer', () => {
    expect(() =>
      resolveBuyerConfirmationPlan({
        ...validContext,
        actorId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toThrow(new ApiError(403, 'BUYER_REQUIRED'));
  });

  it('rejects a shipment scoped to a different order', () => {
    expect(() =>
      resolveBuyerConfirmationPlan({
        ...validContext,
        shipment: {
          ...validContext.shipment,
          order_id: '44444444-4444-4444-8444-444444444444',
        },
      }),
    ).toThrow(new ApiError(409, 'SHIPMENT_ORDER_MISMATCH'));
  });

  it('allows only delivered shipments to reach the canonical RPC', () => {
    expect(() =>
      resolveBuyerConfirmationPlan({
        ...validContext,
        shipment: { ...validContext.shipment, status: 'shipped' },
      }),
    ).toThrow(new ApiError(409, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'));

    expect(resolveBuyerConfirmationPlan(validContext)).toEqual({
      p_shipment_id: shipmentId,
      p_source: 'buyer',
      p_actor_id: buyerId,
      p_idempotency_key: `confirm_shipment_${shipmentId}`,
    });
  });

  it('rejects an active dispute before a delivered shipment can be mutated', () => {
    expect(() =>
      resolveBuyerConfirmationPlan({ ...validContext, hasActiveDispute: true }),
    ).toThrow(new ApiError(409, 'SHIPMENT_HAS_ACTIVE_DISPUTE'));
  });

  it('allows a buyer-owned completed shipment through for canonical idempotency mapping', () => {
    expect(
      resolveBuyerConfirmationPlan({
        ...validContext,
        shipment: { ...validContext.shipment, status: 'completed' },
        hasActiveDispute: true,
      }),
    ).toMatchObject({
      p_shipment_id: shipmentId,
      p_source: 'buyer',
      p_actor_id: buyerId,
    });
  });

  it('forwards no client payment or Connect state to the canonical wallet-guarded RPC', () => {
    const rpcInput = resolveBuyerConfirmationPlan(validContext);

    expect(rpcInput).toEqual({
      p_shipment_id: shipmentId,
      p_source: 'buyer',
      p_actor_id: buyerId,
      p_idempotency_key: `confirm_shipment_${shipmentId}`,
    });
    expect(rpcInput).not.toHaveProperty('amount');
    expect(rpcInput).not.toHaveProperty('stripe_payment_intent_id');
  });
});

describe('mapConfirmationRpcResult', () => {
  it('maps a canonical completion result to the public success contract', () => {
    expect(
      mapConfirmationRpcResult({
        success: true,
        error: null,
        completion_source: 'buyer',
        idempotent: false,
      }, shipmentId),
    ).toEqual({
      success: true,
      shipmentId,
      status: 'completed',
      completionSource: 'buyer',
      idempotent: false,
    });
  });

  it('preserves a duplicate completion as idempotent success', () => {
    expect(
      mapConfirmationRpcResult({
        success: true,
        error: null,
        completion_source: 'auto',
        idempotent: true,
      }, shipmentId),
    ).toEqual({
      success: true,
      shipmentId,
      status: 'completed',
      completionSource: 'auto',
      idempotent: true,
    });
  });

  it('maps canonical state, dispute, and audit failures to conflict responses', () => {
    for (const error of [
      'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
      'SHIPMENT_HAS_ACTIVE_DISPUTE',
      'COMPLETION_AUDIT_MISSING',
    ]) {
      expect(() =>
        mapConfirmationRpcResult(
          { success: false, error, completion_source: null, idempotent: false },
          shipmentId,
        ),
      ).toThrow(new ApiError(409, error));
    }
  });

  it('fails closed for malformed or unexpected RPC output', () => {
    expect(() => mapConfirmationRpcResult(null, shipmentId)).toThrow(
      new ApiError(500, 'INTERNAL_ERROR'),
    );
    expect(() =>
      mapConfirmationRpcResult(
        {
          success: true,
          error: null,
          completion_source: 'unknown',
          idempotent: false,
        },
        shipmentId,
      ),
    ).toThrow(new ApiError(500, 'INTERNAL_ERROR'));
  });
});

describe('buildConfirmationDiagnostic', () => {
  it('emits only secret- and PII-safe identifiers and result fields', () => {
    expect(
      buildConfirmationDiagnostic({
        shipmentId,
        idempotencyKey: validRequest.idempotencyKey,
        result: 'success',
        code: 'COMPLETED',
        actorId: buyerId,
        authorization: 'Bearer secret-token',
      }),
    ).toEqual({
      shipmentId,
      source: 'buyer',
      idempotencyKey: validRequest.idempotencyKey,
      result: 'success',
      code: 'COMPLETED',
    });
  });
});
