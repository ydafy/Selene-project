export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export const AUTO_COMPLETION_DELAY_MS = 48 * 60 * 60 * 1_000;
export const MAX_AUTO_COMPLETION_BATCH_SIZE = 100;

export interface AutoCompletionCandidate {
  id: string;
  status: string;
  delivered_at: string | null;
  buyer_confirmed_at: string | null;
}

export interface AutoCompletionContext {
  method: string;
  suppliedCronSecret: string | null;
  expectedCronSecret: string | null;
  now: number;
  candidates: readonly AutoCompletionCandidate[];
  // Shipments with a dispute that is not resolved or rejected: never auto-completed.
  activeDisputeShipmentIds?: readonly string[];
}

export interface AutoCompletionPlan {
  shipmentIds: string[];
}

export interface CronRequestContext {
  method: string;
  suppliedCronSecret: string | null;
  expectedCronSecret: string | null;
}

export interface AutoCompletionRpcInput {
  p_shipment_id: string;
  p_source: 'auto';
  p_actor_id: null;
  p_idempotency_key: string;
}

export interface AutoCompletionResult {
  shipmentId: string;
  completionSource: 'buyer' | 'auto';
  idempotent: boolean;
}

export interface AutoCompletionBatchResult {
  success: boolean;
  attempted: number;
  completed: number;
  idempotent: number;
  skipped: number;
  failed: number;
}

interface CompletionRpcResult {
  success: boolean;
  error: string | null;
  completion_source: string | null;
  idempotent: boolean;
}

const isCompletionRpcResult = (value: unknown): value is CompletionRpcResult => {
  if (!value || typeof value !== 'object') return false;

  const result = value as Record<string, unknown>;
  return (
    typeof result.success === 'boolean' &&
    (typeof result.error === 'string' || result.error === null) &&
    (typeof result.completion_source === 'string' || result.completion_source === null) &&
    typeof result.idempotent === 'boolean'
  );
};

const isDue = (candidate: AutoCompletionCandidate, now: number): boolean => {
  if (
    candidate.status !== 'delivered' ||
    candidate.buyer_confirmed_at !== null ||
    !candidate.delivered_at
  ) {
    return false;
  }

  const deliveredAt = Date.parse(candidate.delivered_at);
  return Number.isFinite(deliveredAt) && deliveredAt <= now - AUTO_COMPLETION_DELAY_MS;
};

export function validateAutoCompletionRequest(context: CronRequestContext): void {
  if (context.method !== 'POST') {
    throw new ApiError(400, 'INVALID_REQUEST');
  }

  if (!context.expectedCronSecret) {
    throw new ApiError(500, 'INTERNAL_ERROR');
  }

  if (context.suppliedCronSecret !== context.expectedCronSecret) {
    throw new ApiError(401, 'CRON_UNAUTHORIZED');
  }
}

export function resolveAutoCompletionPlan(
  context: AutoCompletionContext,
): AutoCompletionPlan {
  validateAutoCompletionRequest(context);

  const disputed = new Set(context.activeDisputeShipmentIds ?? []);
  return {
    shipmentIds: context.candidates
      .filter((candidate) => isDue(candidate, context.now) && !disputed.has(candidate.id))
      .slice(0, MAX_AUTO_COMPLETION_BATCH_SIZE)
      .map((candidate) => candidate.id),
  };
}

export function buildAutoCompletionRpcInput(
  shipmentId: string,
): AutoCompletionRpcInput {
  return {
    p_shipment_id: shipmentId,
    p_source: 'auto',
    p_actor_id: null,
    p_idempotency_key: `auto_completion_${shipmentId}`,
  };
}

// fn_confirm_shipment_delivery error codes are SCREAMING_SNAKE_CASE; any other text is
// not a code that may reach the logs.
const RPC_ERROR_CODE = /^[A-Z][A-Z_]{0,63}$/;

export function mapAutoCompletionRpcResult(
  value: unknown,
  shipmentId: string,
): AutoCompletionResult {
  if (
    isCompletionRpcResult(value) &&
    !value.success &&
    value.error !== null &&
    RPC_ERROR_CODE.test(value.error)
  ) {
    throw new ApiError(500, value.error);
  }

  if (
    !isCompletionRpcResult(value) ||
    !value.success ||
    value.error !== null ||
    (value.completion_source !== 'buyer' && value.completion_source !== 'auto')
  ) {
    throw new ApiError(500, 'INTERNAL_ERROR');
  }

  return {
    shipmentId,
    completionSource: value.completion_source,
    idempotent: value.idempotent,
  };
}

// fn_confirm_shipment_delivery refuses a shipment whose dispute opened after the candidates
// were read. That is the expected outcome, not a failure: the shipment waits for the dispute.
export function isActiveDisputeRefusal(value: unknown): boolean {
  if (!isCompletionRpcResult(value)) return false;
  return !value.success && value.error === 'SHIPMENT_HAS_ACTIVE_DISPUTE';
}

// A shipment without a Stripe payment intent has no payout path since the wallet was removed, so
// fn_confirm_shipment_delivery refuses it. It is not retried and must not fail the batch.
export function isNotConnectRefusal(value: unknown): boolean {
  if (!isCompletionRpcResult(value)) return false;
  return !value.success && value.error === 'SHIPMENT_NOT_CONNECT';
}

export function summarizeAutoCompletionResults(
  results: readonly (AutoCompletionResult | 'skipped' | null)[],
): AutoCompletionBatchResult {
  return results.reduce<AutoCompletionBatchResult>(
    (summary, result) => {
      if (result === 'skipped') {
        return { ...summary, skipped: summary.skipped + 1 };
      }

      if (!result) {
        return { ...summary, failed: summary.failed + 1, success: false };
      }

      if (result.idempotent) {
        return { ...summary, idempotent: summary.idempotent + 1 };
      }

      return { ...summary, completed: summary.completed + 1 };
    },
    {
      success: true,
      attempted: results.length,
      completed: 0,
      idempotent: 0,
      skipped: 0,
      failed: 0,
    },
  );
}

export function buildAutoCompletionDiagnostic(input: {
  shipmentId?: string;
  result: 'success' | 'failure';
  code: string;
}): {
  source: 'auto';
  shipmentId?: string;
  result: 'success' | 'failure';
  code: string;
} {
  return {
    source: 'auto',
    ...(input.shipmentId ? { shipmentId: input.shipmentId } : {}),
    result: input.result,
    code: input.code,
  };
}
