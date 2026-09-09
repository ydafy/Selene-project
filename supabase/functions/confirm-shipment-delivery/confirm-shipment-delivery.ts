export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ConfirmationRequestBody {
  orderId: string;
  shipmentId: string;
  idempotencyKey: string;
}

export interface BuyerConfirmationContext {
  isMaintenance: boolean;
  actorId: string | null;
  order: { id: string; buyer_id: string } | null;
  shipment: { id: string; order_id: string; status: string } | null;
  hasActiveDispute: boolean;
}

export interface ConfirmationRpcInput {
  p_shipment_id: string;
  p_source: 'buyer';
  p_actor_id: string;
  p_idempotency_key: string;
}

export type ConfirmationSuccess = {
  success: true;
  shipmentId: string;
  status: 'completed';
  completionSource: 'buyer' | 'auto';
  idempotent: boolean;
};

type ConfirmationRpcResult = {
  success: boolean;
  error: string | null;
  completion_source: string | null;
  idempotent: boolean;
};

const conflictCodes = new Set([
  'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
  'SHIPMENT_ORDER_MISMATCH',
  'SHIPMENT_HAS_ACTIVE_DISPUTE',
  'COMPLETION_AUDIT_MISSING',
  'SELLER_WALLET_NOT_FOUND',
  'AUTO_COMPLETION_NOT_DUE',
]);

const isConfirmationRpcResult = (
  value: unknown,
): value is ConfirmationRpcResult => {
  if (!value || typeof value !== 'object') return false;

  const result = value as Record<string, unknown>;
  return (
    typeof result.success === 'boolean' &&
    (typeof result.error === 'string' || result.error === null) &&
    (typeof result.completion_source === 'string' ||
      result.completion_source === null) &&
    typeof result.idempotent === 'boolean'
  );
};

export function parseConfirmationRequestBody(
  body: unknown,
): ConfirmationRequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_REQUEST');
  }

  const request = body as Record<string, unknown>;
  const allowedKeys = new Set(['orderId', 'shipmentId', 'idempotencyKey']);
  if (
    Object.keys(request).some((key) => !allowedKeys.has(key)) ||
    typeof request.orderId !== 'string' ||
    typeof request.shipmentId !== 'string' ||
    typeof request.idempotencyKey !== 'string' ||
    !uuidPattern.test(request.orderId) ||
    !uuidPattern.test(request.shipmentId) ||
    request.idempotencyKey !== `confirm_shipment_${request.shipmentId}`
  ) {
    throw new ApiError(400, 'INVALID_REQUEST');
  }

  return {
    orderId: request.orderId,
    shipmentId: request.shipmentId,
    idempotencyKey: request.idempotencyKey,
  };
}

export function resolveBuyerConfirmationPlan(
  context: BuyerConfirmationContext,
): ConfirmationRpcInput {
  if (!context.actorId) {
    throw new ApiError(401, 'AUTH_REQUIRED');
  }

  if (context.isMaintenance) {
    throw new ApiError(503, 'MAINTENANCE_MODE');
  }

  if (!context.order || !context.shipment) {
    throw new ApiError(404, 'SHIPMENT_NOT_FOUND');
  }

  if (context.order.buyer_id !== context.actorId) {
    throw new ApiError(403, 'BUYER_REQUIRED');
  }

  if (context.shipment.order_id !== context.order.id) {
    throw new ApiError(409, 'SHIPMENT_ORDER_MISMATCH');
  }

  if (context.shipment.status !== 'delivered' && context.shipment.status !== 'completed') {
    throw new ApiError(409, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE');
  }

  if (context.shipment.status === 'delivered' && context.hasActiveDispute) {
    throw new ApiError(409, 'SHIPMENT_HAS_ACTIVE_DISPUTE');
  }

  return {
    p_shipment_id: context.shipment.id,
    p_source: 'buyer',
    p_actor_id: context.actorId,
    p_idempotency_key: `confirm_shipment_${context.shipment.id}`,
  };
}

export function mapConfirmationRpcResult(
  value: unknown,
  shipmentId: string,
): ConfirmationSuccess {
  if (!isConfirmationRpcResult(value)) {
    throw new ApiError(500, 'INTERNAL_ERROR');
  }

  if (value.success) {
    if (
      (value.completion_source !== 'buyer' && value.completion_source !== 'auto') ||
      value.error !== null
    ) {
      throw new ApiError(500, 'INTERNAL_ERROR');
    }

    return {
      success: true,
      shipmentId,
      status: 'completed',
      completionSource: value.completion_source,
      idempotent: value.idempotent,
    };
  }

  if (!value.error) {
    throw new ApiError(500, 'INTERNAL_ERROR');
  }

  if (value.error === 'BUYER_REQUIRED') {
    throw new ApiError(403, value.error);
  }

  if (value.error === 'SHIPMENT_NOT_FOUND') {
    throw new ApiError(404, value.error);
  }

  if (value.error === 'MAINTENANCE_MODE') {
    throw new ApiError(503, value.error);
  }

  if (conflictCodes.has(value.error)) {
    throw new ApiError(409, value.error);
  }

  if (
    value.error === 'INVALID_COMPLETION_SOURCE' ||
    value.error === 'IDEMPOTENCY_KEY_REQUIRED' ||
    value.error === 'INVALID_IDEMPOTENCY_KEY'
  ) {
    throw new ApiError(400, value.error);
  }

  throw new ApiError(500, 'INTERNAL_ERROR');
}

export function buildConfirmationDiagnostic(input: {
  shipmentId: string;
  idempotencyKey: string;
  result: 'success' | 'failure';
  code: string;
  actorId?: string;
  authorization?: string;
}): {
  shipmentId: string;
  source: 'buyer';
  idempotencyKey: string;
  result: 'success' | 'failure';
  code: string;
} {
  return {
    shipmentId: input.shipmentId,
    source: 'buyer',
    idempotencyKey: input.idempotencyKey,
    result: input.result,
    code: input.code,
  };
}
