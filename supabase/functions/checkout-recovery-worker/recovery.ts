export type RecoveryClassification =
  | { kind: 'semantic'; refundRequired: true }
  | { kind: 'transient'; refundRequired: false };

export type RecoveryClaim =
  { kind: 'claimed' } | { kind: 'busy' } | { kind: 'refunded' };

export type RecoveryResult =
  | { kind: 'busy' }
  | { kind: 'refunded'; refundId: string }
  | { kind: 'retry_queued' }
  | { kind: 'reconciliation_needed'; reason: 'missing_charge_evidence' };

type RecoveryClaimScope = 'order' | 'standalone';

const RECOVERY_CLAIM_BUDGET = {
  order: 12,
  standalone: 13,
} as const;

/** Claims a fixed fair-share cron budget before any refund work begins. */
export async function claimCheckoutRecoveryShells<T>(
  claim: (input: { limit: number; scope: RecoveryClaimScope }) => Promise<T[]>,
): Promise<T[]> {
  const orderClaims = await claim({
    limit: RECOVERY_CLAIM_BUDGET.order,
    scope: 'order',
  });
  const standaloneClaims = await claim({
    limit: RECOVERY_CLAIM_BUDGET.standalone,
    scope: 'standalone',
  });

  return [...orderClaims, ...standaloneClaims];
}

/** Completes each claimed financial recovery before starting the next one. */
export async function processRecoveryClaimsSequentially<T, TResult>(
  claims: readonly T[],
  process: (claim: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  for (const claim of claims) {
    results.push(await process(claim));
  }
  return results;
}

const SEMANTIC_FAILURE_CODES = new Set([
  'ONE_PRODUCT_PER_SHIPMENT_REQUIRED',
  'PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED',
  'PRODUCT_NOT_RESERVED',
]);

export function isAuthorizedCheckoutRecoveryWorker(input: {
  authorization: string | null;
  workerServiceRoleJwt: string | undefined;
}): boolean {
  return (
    input.workerServiceRoleJwt !== undefined &&
    input.workerServiceRoleJwt.length > 0 &&
    input.authorization === `Bearer ${input.workerServiceRoleJwt}`
  );
}

export function classifySettlementFailure(
  reason: string,
): RecoveryClassification {
  if (
    SEMANTIC_FAILURE_CODES.has(reason) ||
    reason.startsWith('INVALID_') ||
    reason === 'LEGACY_GROUPED_SETTLEMENT_METADATA'
  ) {
    return { kind: 'semantic', refundRequired: true };
  }

  return { kind: 'transient', refundRequired: false };
}

export function buildRecoveryRefundParams(input: {
  paymentIntentId: string;
  hasDestinationTransfer: boolean;
}): {
  paymentIntentId: string;
  idempotencyKey: string;
  reverseTransfer?: true;
} {
  return {
    paymentIntentId: input.paymentIntentId,
    idempotencyKey: `pi_${input.paymentIntentId}_recovery`,
    ...(input.hasDestinationTransfer ? { reverseTransfer: true as const } : {}),
  };
}

export async function compensateRecoveryShell(
  input: {
    paymentIntentId: string;
    hasDestinationTransfer: boolean;
    chargeEvidence?: 'present' | 'missing';
  },
  dependencies: {
    claim: () => Promise<RecoveryClaim>;
    createRefund: (
      params: ReturnType<typeof buildRecoveryRefundParams>,
    ) => Promise<{ id: string }>;
    finalize: (input: { refundId: string }) => Promise<void>;
    queueRetry: (input: { error: string }) => Promise<void>;
  },
): Promise<RecoveryResult> {
  const claim = await dependencies.claim();
  if (claim.kind !== 'claimed') {
    return { kind: 'busy' };
  }

  if (input.chargeEvidence === 'missing') {
    return { kind: 'reconciliation_needed', reason: 'missing_charge_evidence' };
  }

  try {
    const refund = await dependencies.createRefund(
      buildRecoveryRefundParams(input),
    );
    await dependencies.finalize({ refundId: refund.id });
    return { kind: 'refunded', refundId: refund.id };
  } catch (error) {
    await dependencies.queueRetry({
      error: error instanceof Error ? error.message : 'UNKNOWN_REFUND_ERROR',
    });
    return { kind: 'retry_queued' };
  }
}
