import type {
  ConnectPayoutReleaseQueueRow,
  ConnectPayoutReleaseRequest,
  ConnectPayoutRun,
} from '../../../packages/types/src/index.ts';

export type ConnectPayoutRunStatus =
  | 'pending_reconciliation'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'reconciliation_needed';

export type ReleaseQueueRow = Pick<
  ConnectPayoutReleaseQueueRow,
  | 'shipment_id'
  | 'seller_id'
  | 'order_id'
  | 'status'
  | 'completed_at'
  | 'is_eligible'
  | 'ineligible_reason'
  | 'release_amount_cents'
  | 'stripe_account_id'
  | 'stripe_onboarding_status'
  | 'stripe_transfer_id'
>;

export interface ReleaseSettlementOrder {
  id: string;
  stripe_charge_id: string | null;
  stripe_transfer_group: string | null;
}

export type ExistingConnectPayoutRun = Pick<
  ConnectPayoutRun,
  'id' | 'seller_id' | 'amount' | 'stripe_payout_id'
> & {
  shipment_ids: string[];
  status: ConnectPayoutRunStatus;
  /** Phase 2B durable release stage; NULL on pre-fencing legacy runs. */
  release_stage?: string | null;
  release_stage_version?: number;
  /** Phase 2B executor claim token; NULL/absent when the run is unclaimed. */
  payout_claim_token?: string | null;
  /** Phase 2B executor claim lease expiry; live while after now(). */
  payout_claim_expires_at?: string | null;
};

export interface ActiveConnectPayoutRunShipment {
  shipmentId: string;
  runId: string;
  status: Extract<
    ConnectPayoutRunStatus,
    'pending_reconciliation' | 'paid' | 'reconciliation_needed'
  >;
}

export interface CreatedConnectPayoutRun {
  id: string;
  status: ConnectPayoutRunStatus;
  release_stage: string | null;
  release_stage_version: number;
}

export interface ResumeMappingIntent {
  runId: string;
  expectedStatus: ConnectPayoutRunStatus;
  expectedStage: string | null;
  expectedVersion: number;
  shipmentIds: string[];
  parent: { runId: string; stageVersion: number; stripePayoutId: string } | null;
}

/** Migration-owned boundary until maintainer applies SQL and regenerates types.
 * It adds no guessed functions to Database and does not widen the client.
 */
export interface AtomicResumeMappingArgs {
  p_run_id: string;
  p_mode: 'retry' | 'pending';
  p_expected_status: string;
  p_expected_stage: string | null;
  p_expected_version: number;
  p_shipment_ids: string[];
  p_parent_run_id: string | null;
  p_expected_parent_version: number | null;
  p_expected_parent_payout_id: string | null;
}

export function atomicResumeMappingArgs(input: ResumeMappingIntent, mode: 'retry' | 'pending'): AtomicResumeMappingArgs {
  return {
    p_run_id: input.runId, p_mode: mode, p_expected_status: input.expectedStatus,
    p_expected_stage: input.expectedStage, p_expected_version: input.expectedVersion,
    p_shipment_ids: input.shipmentIds, p_parent_run_id: input.parent?.runId ?? null,
    p_expected_parent_version: input.parent?.stageVersion ?? null,
    p_expected_parent_payout_id: input.parent?.stripePayoutId ?? null,
  };
}

function snapshotResumeIntent(run: { id: string; status: ConnectPayoutRunStatus; release_stage?: string | null; release_stage_version?: number }, shipmentIds: string[], parent: ExistingConnectPayoutRun | null): ResumeMappingIntent {
  if (!Number.isSafeInteger(run.release_stage_version) || (run.release_stage_version ?? 0) < 1 ||
      (parent && (!Number.isSafeInteger(parent.release_stage_version) || !parent.stripe_payout_id))) {
    throw new ConnectPayoutReleaseError('PAYOUT_RESUME_SNAPSHOT_REQUIRED', 409);
  }
  return { runId: run.id, expectedStatus: run.status, expectedStage: run.release_stage ?? null,
    expectedVersion: run.release_stage_version!, shipmentIds: [...shipmentIds],
    parent: parent ? { runId: parent.id, stageVersion: parent.release_stage_version!, stripePayoutId: parent.stripe_payout_id! } : null };
}

function assertResumeApplied(version: number | null): number {
  if (!Number.isSafeInteger(version) || (version ?? 0) < 1) throw new ConnectPayoutReleaseError('PAYOUT_RESUME_MAPPING_CONFLICT', 409);
  return version!;
}

export interface ConnectedBalanceEntry {
  amount: number;
  currency: string;
}

export interface ConnectedBalancePreflightResult {
  requiredAmountCents: number;
  availableAmountCents: number;
  currency: 'mxn';
  isSufficient: boolean;
}

export interface ConnectPayoutReleaseDependencies {
  getActorProfile: (actorId: string) => Promise<{ role: string | null } | null>;
  findRunByIdempotencyKey: (
    idempotencyKey: string,
  ) => Promise<ExistingConnectPayoutRun | null>;
  findRunById: (runId: string) => Promise<ExistingConnectPayoutRun | null>;
  findRetryChildByParentRunId: (
    parentRunId: string,
  ) => Promise<ExistingConnectPayoutRun | null>;
  findActiveShipmentMappings: (
    shipmentIds: string[],
  ) => Promise<ActiveConnectPayoutRunShipment[]>;
  loadReleaseRows: (shipmentIds: string[]) => Promise<ReleaseQueueRow[]>;
  loadReleaseOrders: (orderIds: string[]) => Promise<ReleaseSettlementOrder[]>;
  createRun: (input: {
    actorId: string;
    sellerId: string;
    amount: number;
    idempotencyKey: string;
    retryOfRunId?: string;
  }) => Promise<CreatedConnectPayoutRun>;
  createRunShipments: (input: {
    runId: string;
    shipments: Array<{ shipmentId: string; netPayout: number }>;
  }) => Promise<void>;
  createStripeTransfer: (input: {
    stripeAccountId: string;
    amount: number;
    currency: 'mxn';
    sourceTransaction: string;
    transferGroup: string;
    idempotencyKey: string;
    metadata: {
      app_name: 'selene';
      run_id: string;
      shipment_id: string;
      seller_id: string;
      order_id: string;
    };
  }) => Promise<{ id: string }>;
  markShipmentStripeTransferId: (input: {
    shipmentId: string;
    stripeTransferId: string;
  }) => Promise<void>;
  retrieveConnectedBalance: (input: {
    stripeAccountId: string;
  }) => Promise<{ available: ConnectedBalanceEntry[] }>;
  retrieveStripePayout: (input: {
    payoutId: string;
    stripeAccountId: string;
  }) => Promise<{
    id: string;
    status: string;
    failure_balance_transaction: string | { id: string } | null;
    amount: number;
    currency: string;
  }>;
  /**
   * Phase 2B account actionability gate. Resolved through the service-role
   * RPC `fn_get_connect_account_actionability` only — the actionability
   * projection tables are revoked from every role and must never be
   * direct-selected here. An unevidenced account defaults to actionable.
   */
  getConnectAccountActionability: (input: {
    stripeAccountId: string;
  }) => Promise<{ isActionable: boolean; blockedReason: string | null }>;
  createStripePayout: (input: {
    stripeAccountId: string;
    amount: number;
    currency: 'mxn';
    idempotencyKey: string;
    metadata: {
      app_name: 'selene';
      run_id: string;
      seller_id: string;
      shipment_ids: string;
    };
    orderIds: string[];
  }) => Promise<{ id: string }>;
  markRunRetrying: (input: ResumeMappingIntent) => Promise<number | null>;
  markRunPendingReconciliation: (input: ResumeMappingIntent) => Promise<number | null>;
  /**
   * Phase 2B final slice: guarded post-Stripe sync fallback. Returns TRUE
   * when the guarded RPC applied the reconciliation park (the run sits in a
   * non-terminal state and the durable stage is preserved for the executor
   * reconciliation claim). Returns FALSE when the run already sits in a
   * terminal or newer durable state (e.g. a webhook projected the outcome):
   * terminal authority is preserved and the caller performs no further
   * write.
   */
  markRunPayoutSyncFailed: (input: {
    runId: string;
    stripePayoutId: string;
    failureReason: string;
  }) => Promise<boolean>;
  /**
   * Phase 2B durable write-ahead fence: opens the payout_create_in_progress
   * transition BEFORE the Stripe payout create. Raises when the fence is
   * already open or the run is not in a pre-payout stage; a fenced or
   * otherwise unopenable run must never reach Stripe.
   */
  beginPayoutCreateFence: (input: {
    runId: string;
  }) => Promise<number>;
  completePayoutCreateFence: (input: {
    runId: string;
    stageVersion: number;
    stripePayoutId: string;
  }) => Promise<boolean>;
  failPayoutCreateFromFence: (input: {
    runId: string;
    stageVersion: number;
    failureReason: string;
  }) => Promise<boolean>;
  abortPayoutCreateToActionRequired: (input: {
    runId: string;
    stageVersion: number;
    reason: string;
  }) => Promise<boolean>;
}

export type ReleaseConnectPayoutResponse =
  | {
      success: true;
      runId: string;
      stripePayoutId?: string;
      status: ConnectPayoutRunStatus;
      amount: number;
    }
  | {
      success: false;
      error: string;
      code?: 'stripe_balance_insufficient';
      retryable?: boolean;
      required_amount_cents?: number;
      available_amount_cents?: number;
      currency?: 'mxn';
    };

type StripeBalanceInsufficientResponse = Extract<
  ReleaseConnectPayoutResponse,
  { success: false; code?: 'stripe_balance_insufficient' }
>;

export function getStripeBalanceInsufficientLogMeta(input: {
  sellerId: string;
  shipmentCount: number;
  response: StripeBalanceInsufficientResponse;
}): Record<string, unknown> {
  return {
    sellerId: input.sellerId,
    shipmentCount: input.shipmentCount,
    code: input.response.code,
    required_amount_cents: input.response.required_amount_cents,
    available_amount_cents: input.response.available_amount_cents,
    currency: input.response.currency,
    retryable: input.response.retryable,
  };
}

export class ConnectPayoutReleaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ConnectPayoutReleaseError';
  }
}

export function getConnectPayoutReleaseErrorStatus(message: string): number {
  if (message === 'AUTH_REQUIRED') return 401;
  if (message === 'ADMIN_REQUIRED') return 403;
  if (message === 'MISSING_SERVER_CONFIG') return 500;
  return 400;
}

function assertNonEmptyString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConnectPayoutReleaseError(error, 400);
  }

  return value.trim();
}

export function parseReleaseRequestBody(
  body: unknown,
): ConnectPayoutReleaseRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConnectPayoutReleaseError('INVALID_REQUEST', 400);
  }

  const record = body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'retryRunId')) {
    if (Object.keys(record).length !== 1) {
      throw new ConnectPayoutReleaseError('INVALID_RETRY_REQUEST', 400);
    }

    return {
      retryRunId: assertNonEmptyString(
        record.retryRunId,
        'RETRY_RUN_ID_REQUIRED',
      ),
    };
  }

  const sellerId = assertNonEmptyString(record.sellerId, 'SELLER_ID_REQUIRED');
  const idempotencyKey = assertNonEmptyString(
    record.idempotencyKey,
    'IDEMPOTENCY_KEY_REQUIRED',
  );

  if (!Array.isArray(record.shipmentIds) || record.shipmentIds.length === 0) {
    throw new ConnectPayoutReleaseError('SHIPMENTS_REQUIRED', 400);
  }

  const shipmentIds = [
    ...new Set(
      record.shipmentIds.map((id) =>
        assertNonEmptyString(id, 'INVALID_SHIPMENT_ID'),
      ),
    ),
  ];
  if (shipmentIds.length === 0) {
    throw new ConnectPayoutReleaseError('SHIPMENTS_REQUIRED', 400);
  }

  return { sellerId, shipmentIds, idempotencyKey };
}

function assertEligibleRows(
  sellerId: string,
  requestedShipmentIds: string[],
  rows: ReleaseQueueRow[],
  options: {
    allowedIneligibleReasons: readonly string[];
    /**
     * Per-shipment override for fence-time, owner-scoped revalidation: the
     * tolerated ineligible reasons for one specific shipment. Falls back to
     * the global list when absent.
     */
    allowedIneligibleReasonsForShipment?: (
      shipmentId: string,
    ) => readonly string[];
  } = { allowedIneligibleReasons: [] },
): asserts rows is Array<
  ReleaseQueueRow & {
    shipment_id: string;
    seller_id: string;
    release_amount_cents: number;
    stripe_account_id: string;
  }
> {
  if (rows.length !== requestedShipmentIds.length) {
    throw new ConnectPayoutReleaseError('SHIPMENT_NOT_FOUND', 400);
  }

  const requested = new Set(requestedShipmentIds);
  for (const row of rows) {
    if (!row.shipment_id || !requested.has(row.shipment_id)) {
      throw new ConnectPayoutReleaseError('SHIPMENT_NOT_FOUND', 400);
    }
    if (row.seller_id !== sellerId) {
      throw new ConnectPayoutReleaseError('MIXED_SELLERS', 400);
    }
    if (row.status !== 'completed' || !row.completed_at) {
      throw new ConnectPayoutReleaseError('SHIPMENT_NOT_COMPLETED', 400);
    }
    const allowedIneligibleReasons =
      options.allowedIneligibleReasonsForShipment?.(row.shipment_id) ??
      options.allowedIneligibleReasons;
    if (
      row.is_eligible !== true &&
      !(
        row.ineligible_reason &&
        allowedIneligibleReasons.includes(row.ineligible_reason)
      )
    ) {
      throw new ConnectPayoutReleaseError(
        row.ineligible_reason ?? 'SHIPMENT_INELIGIBLE',
        400,
      );
    }
    if (!row.stripe_account_id || row.stripe_onboarding_status !== 'complete') {
      throw new ConnectPayoutReleaseError('CONNECT_ACCOUNT_NOT_READY', 400);
    }
    if (!row.release_amount_cents || row.release_amount_cents <= 0) {
      throw new ConnectPayoutReleaseError('INVALID_RELEASE_AMOUNT', 400);
    }
  }
}

function normalizeShipmentIds(shipmentIds: string[]): string[] {
  return [...new Set(shipmentIds)].sort();
}

function hasEquivalentRequest(
  run: ExistingConnectPayoutRun,
  request: { sellerId: string; shipmentIds: string[] },
): boolean {
  return (
    run.seller_id === request.sellerId &&
    normalizeShipmentIds(run.shipment_ids).join('\0') ===
      normalizeShipmentIds(request.shipmentIds).join('\0')
  );
}

function toFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ExecutorClaimConflict = 'live' | 'stale';

/**
 * Classifies an executor claim held on a run. A live lease means the worker is
 * mid-flight; a stale lease means executor ownership already lapsed. Both park
 * the manual release: the endpoint never takes a claimed run into Stripe, and
 * an unreconciled claim (live or lapsed) belongs to executor reconciliation.
 */
function getExecutorClaimConflict(
  run: ExistingConnectPayoutRun,
): ExecutorClaimConflict | null {
  if (!run.payout_claim_token) return null;

  const expiresAt = run.payout_claim_expires_at
    ? Date.parse(run.payout_claim_expires_at)
    : NaN;
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
    ? 'live'
    : 'stale';
}

function assertNoExecutorClaim(run: ExistingConnectPayoutRun): void {
  if (getExecutorClaimConflict(run) !== null) {
    throw new ConnectPayoutReleaseError(
      'PAYOUT_RELEASE_EXECUTOR_CLAIM_CONFLICT',
      409,
    );
  }
}

/**
 * Phase 2B account actionability gate: a seller destination Stripe reports
 * as not actionable (or whose actionability is unevidenced but blocked) can
 * never fund a payout. Called before any transfer, run write, or balance
 * preflight, and re-checked at fence time; the resolved state is refused
 * with a 409 so the release parks instead of racing Stripe.
 */
async function assertAccountActionable(
  deps: ConnectPayoutReleaseDependencies,
  stripeAccountId: string,
): Promise<void> {
  const actionability = await deps.getConnectAccountActionability({
    stripeAccountId,
  });
  if (!actionability.isActionable) {
    throw new ConnectPayoutReleaseError(
      'CONNECT_ACCOUNT_NOT_ACTIONABLE',
      409,
    );
  }
}

export function sumAvailableBalanceForCurrency(
  entries: ConnectedBalanceEntry[],
  currency: 'mxn',
): number {
  return entries.reduce(
    (total, entry) =>
      entry.currency === currency ? total + entry.amount : total,
    0,
  );
}

async function preflightConnectedBalance(input: {
  stripeAccountId: string;
  requiredAmountCents: number;
  currency: 'mxn';
  retrieveConnectedBalance: ConnectPayoutReleaseDependencies['retrieveConnectedBalance'];
}): Promise<ConnectedBalancePreflightResult> {
  const balance = await input.retrieveConnectedBalance({
    stripeAccountId: input.stripeAccountId,
  });
  const availableAmountCents = sumAvailableBalanceForCurrency(
    balance.available,
    input.currency,
  );

  return {
    requiredAmountCents: input.requiredAmountCents,
    availableAmountCents,
    currency: input.currency,
    isSufficient: availableAmountCents >= input.requiredAmountCents,
  };
}

function getStripeErrorField(
  error: unknown,
  field: 'type' | 'code' | 'statusCode',
): unknown {
  if (!error || typeof error !== 'object') return undefined;

  const record = error as Record<string, unknown>;
  const raw =
    record.raw && typeof record.raw === 'object'
      ? (record.raw as Record<string, unknown>)
      : undefined;

  return record[field] ?? raw?.[field];
}

export function isDefinitiveStripePayoutCreateFailure(error: unknown): boolean {
  const type = getStripeErrorField(error, 'type');
  const code = getStripeErrorField(error, 'code');
  const statusCode = getStripeErrorField(error, 'statusCode');

  if (
    type === 'StripeConnectionError' ||
    type === 'StripeAPIError' ||
    type === 'StripeIdempotencyError' ||
    type === 'idempotency_error' ||
    code === 'idempotency_error'
  ) {
    return false;
  }

  if (typeof statusCode !== 'number') return false;
  if (statusCode === 409 || statusCode >= 500) return false;

  return statusCode >= 400 && statusCode < 500;
}

function isRetryableExistingRun(run: ExistingConnectPayoutRun): boolean {
  return (
    run.stripe_payout_id === null &&
    (run.status === 'failed' || run.status === 'pending_reconciliation')
  );
}

function normalizeOrderIds(rows: ReleaseQueueRow[]): string[] {
  return [...new Set(rows.map((row) => row.order_id).filter(Boolean))].filter(
    (orderId): orderId is string => Boolean(orderId),
  );
}

function buildTransferIdempotencyKey(input: {
  idempotencyKey: string;
  runId: string;
  shipmentId: string;
}): string {
  return `${input.idempotencyKey}:${input.runId}:${input.shipmentId}`;
}

function buildRetryIdempotencyKey(parentRunId: string): string {
  return `connect-payout-retry:${parentRunId}`;
}

function existingRunResponse(
  run: ExistingConnectPayoutRun,
): ReleaseConnectPayoutResponse {
  return {
    success: true,
    runId: run.id,
    ...(run.stripe_payout_id
      ? { stripePayoutId: run.stripe_payout_id }
      : {}),
    status: run.status,
    amount: run.amount,
  };
}

type OriginalReleaseRequest = Extract<
  ConnectPayoutReleaseRequest,
  { sellerId: string }
>;

export async function releaseConnectPayout(
  input: ConnectPayoutReleaseRequest & { actorId: string },
  deps: ConnectPayoutReleaseDependencies,
): Promise<ReleaseConnectPayoutResponse> {
  const actor = await deps.getActorProfile(input.actorId);
  if (actor?.role !== 'admin') {
    throw new ConnectPayoutReleaseError('ADMIN_REQUIRED', 403);
  }

  let request: OriginalReleaseRequest;
  let retryParent: ExistingConnectPayoutRun | null = null;

  if ('retryRunId' in input) {
    const retryRunId = assertNonEmptyString(input.retryRunId, 'RETRY_RUN_ID_REQUIRED');
    retryParent = await deps.findRunById(retryRunId);
    if (!retryParent) {
      throw new ConnectPayoutReleaseError('PAYOUT_RETRY_PARENT_NOT_FOUND', 404);
    }
    if (retryParent.status !== 'failed') {
      throw new ConnectPayoutReleaseError(
        'PAYOUT_RETRY_PARENT_NOT_FAILED',
        409,
      );
    }

    if (!retryParent.stripe_payout_id?.trim()) {
      throw new ConnectPayoutReleaseError('PAYOUT_RETRY_EVIDENCE_REQUIRED', 409);
    }

    request = {
      sellerId: retryParent.seller_id,
      shipmentIds: retryParent.shipment_ids,
      idempotencyKey: buildRetryIdempotencyKey(retryParent.id),
    };
  } else {
    request = input;
  }

  const existingRun = retryParent
    ? null
    : await deps.findRunByIdempotencyKey(request.idempotencyKey);
  const resumedRun =
    existingRun && isRetryableExistingRun(existingRun) ? existingRun : null;
  if (existingRun) {
    if (!hasEquivalentRequest(existingRun, request)) {
      throw new ConnectPayoutReleaseError('IDEMPOTENCY_KEY_CONFLICT', 409);
    }

    // A run already durably fenced in payout_create_in_progress holds an
    // unreconciled Stripe create attempt: the executor reconciles it by
    // server-side listing; this endpoint must never recreate a payout for it.
    if (resumedRun?.release_stage === 'payout_create_in_progress') {
      throw new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      );
    }

    // A resumed run holding an executor claim (live or stale) belongs to the
    // worker: park the release for reconciliation instead of racing the
    // executor into Stripe.
    if (resumedRun) {
      assertNoExecutorClaim(resumedRun);
    }

    if (!resumedRun) {
      if (
        existingRun.stripe_payout_id === null &&
        (existingRun.status === 'pending_reconciliation' ||
          existingRun.status === 'reconciliation_needed')
      ) {
        throw new ConnectPayoutReleaseError(
          'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
          409,
        );
      }

      if (existingRun.status === 'failed') {
        throw new ConnectPayoutReleaseError(
          'PAYOUT_RELEASE_PREVIOUSLY_FAILED',
          409,
        );
      }

      return existingRunResponse(existingRun);
    }
  }

  // Capture server ownership BEFORE balance/evidence/transfer awaits. Never
  // refresh the version at the delayed write to legitimize stale intent.
  const resumedIntent = resumedRun ? snapshotResumeIntent(resumedRun, resumedRun.shipment_ids, retryParent) : null;
  const parentSnapshot = retryParent ? { ...retryParent } : null;

  const activeMappings = await deps.findActiveShipmentMappings(
    request.shipmentIds,
  );
  const conflictingActiveMappings = activeMappings.filter(
    (mapping) => mapping.runId !== resumedRun?.id,
  );
  if (conflictingActiveMappings.length > 0) {
    throw new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409);
  }

  const eligibilityOptions = {
    allowedIneligibleReasons: retryParent
      ? (['payout_failed_retry_required'] as const)
      : resumedRun
        ? (['already_released'] as const)
        : ([] as const),
  };

  const rows = await deps.loadReleaseRows(request.shipmentIds);
  assertEligibleRows(request.sellerId, request.shipmentIds, rows, eligibilityOptions);

  const currentAmount = rows.reduce(
    (total, row) => total + row.release_amount_cents,
    0,
  );
  const expectedRun = retryParent ?? resumedRun;
  if (expectedRun && currentAmount !== expectedRun.amount) {
    throw new ConnectPayoutReleaseError('PAYOUT_RELEASE_AMOUNT_CHANGED', 409);
  }
  const amount = expectedRun?.amount ?? currentAmount;

  if (retryParent) {
    const payoutId = retryParent.stripe_payout_id!;
    let payout: Awaited<ReturnType<ConnectPayoutReleaseDependencies['retrieveStripePayout']>>;
    try {
      payout = await deps.retrieveStripePayout({
        payoutId,
        stripeAccountId: rows[0].stripe_account_id,
      });
    } catch {
      throw new ConnectPayoutReleaseError('PAYOUT_RETRY_EVIDENCE_UNAVAILABLE', 409);
    }
    const balanceTransaction = payout?.failure_balance_transaction;
    const hasReturnedFundsEvidence =
      typeof balanceTransaction === 'string'
        ? balanceTransaction.trim().length > 0
        : typeof balanceTransaction?.id === 'string' &&
          balanceTransaction.id.trim().length > 0;
    if (
      payout?.id !== payoutId ||
      payout.status !== 'failed' ||
      !hasReturnedFundsEvidence ||
      payout.amount !== amount ||
      payout.currency !== 'mxn'
    ) {
      throw new ConnectPayoutReleaseError('PAYOUT_RETRY_EVIDENCE_REQUIRED', 409);
    }
  }

  if (retryParent) {
    const existingChild = await deps.findRetryChildByParentRunId(retryParent.id);
    if (existingChild) return existingRunResponse(existingChild);
  }

  // Account actionability gate: refuse before any durable write, transfer,
  // or balance preflight when the seller destination is not actionable.
  await assertAccountActionable(deps, rows[0].stripe_account_id);

  const orderIds = normalizeOrderIds(rows);
  const orders = await deps.loadReleaseOrders(orderIds);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  if (orderIds.some((orderId) => !orderById.has(orderId))) {
    throw new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400);
  }

  const hasSingleModalSettlement = orders.some(
    (order) => order.stripe_transfer_group !== null,
  );
  if (
    hasSingleModalSettlement &&
    orders.some(
      (order) =>
        !order.stripe_transfer_group || !order.stripe_charge_id,
    )
  ) {
    throw new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400);
  }

  if (!hasSingleModalSettlement) {
    const balancePreflight = await preflightConnectedBalance({
      stripeAccountId: rows[0].stripe_account_id,
      requiredAmountCents: rows.reduce(
        (total, row) => total + (row.release_amount_cents ?? 0),
        0,
      ),
      currency: 'mxn',
      retrieveConnectedBalance: deps.retrieveConnectedBalance,
    });
    if (!balancePreflight.isSufficient) {
      return {
        success: false,
        error: 'Connected account available balance is insufficient for this payout.',
        code: 'stripe_balance_insufficient',
        retryable: true,
        required_amount_cents: balancePreflight.requiredAmountCents,
        available_amount_cents: balancePreflight.availableAmountCents,
        currency: balancePreflight.currency,
      };
    }
  }

  const run =
    resumedRun ??
    (await deps.createRun({
      actorId: input.actorId,
      sellerId: request.sellerId,
      amount,
      idempotencyKey: request.idempotencyKey,
      ...(retryParent ? { retryOfRunId: retryParent.id } : {}),
    }));

  let resumeIntent = resumedIntent ?? snapshotResumeIntent(run, request.shipmentIds, parentSnapshot);
  if (resumedRun) {
    const version = assertResumeApplied(await deps.markRunRetrying(resumeIntent));
    resumeIntent = { ...resumeIntent, expectedStatus: 'pending_reconciliation', expectedStage: 'awaiting_connected_balance', expectedVersion: version };
  } else {
    await deps.createRunShipments({
      runId: run.id,
      shipments: rows.map((row) => ({
        shipmentId: row.shipment_id,
        netPayout: row.release_amount_cents,
      })),
    });
  }

  if (hasSingleModalSettlement) {
    for (const row of rows) {
      if (row.stripe_transfer_id) {
        continue;
      }

      const order = row.order_id ? orderById.get(row.order_id) : null;
      if (!order?.stripe_charge_id || !order.stripe_transfer_group) {
        throw new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400);
      }

      const transfer = await deps.createStripeTransfer({
        stripeAccountId: row.stripe_account_id,
        amount: row.release_amount_cents,
        currency: 'mxn',
        sourceTransaction: order.stripe_charge_id,
        transferGroup: order.stripe_transfer_group,
        idempotencyKey: buildTransferIdempotencyKey({
          idempotencyKey: request.idempotencyKey,
          runId: run.id,
          shipmentId: row.shipment_id,
        }),
        metadata: {
          app_name: 'selene',
          run_id: run.id,
          shipment_id: row.shipment_id,
          seller_id: request.sellerId,
          order_id: order.id,
        },
      });

      await deps.markShipmentStripeTransferId({
        shipmentId: row.shipment_id,
        stripeTransferId: transfer.id,
      });
    }

    const balancePreflight = await preflightConnectedBalance({
      stripeAccountId: rows[0].stripe_account_id,
      requiredAmountCents: amount,
      currency: 'mxn',
      retrieveConnectedBalance: deps.retrieveConnectedBalance,
    });

    if (!balancePreflight.isSufficient) {
      assertResumeApplied(await deps.markRunPendingReconciliation(resumeIntent));
      return {
        success: true,
        runId: run.id,
        status: 'pending_reconciliation',
        amount,
      };
    }
  }

  // Durable ownership revalidation at the fence: re-read the run right
  // before fencing so an executor claim or a newer durable stage projected
  // after the first lookup can never be bypassed by this endpoint.
  const currentRun = await deps.findRunById(run.id);
  if (currentRun) {
    if (currentRun.release_stage === 'payout_create_in_progress') {
      throw new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      );
    }
    assertNoExecutorClaim(currentRun);
  }

  let payout: { id: string };
  const fencedVersion = await openPayoutCreateFence(deps, run.id);

  // Revalidate current release eligibility inside the fence, immediately
  // before Stripe: an active dispute or another eligibility/amount change
  // after the first read must never reach payouts.create. Stripe has not
  // been called, so the fence exits with definitive failed semantics when
  // the exit still holds; a lost exit race keeps the newer durable decision
  // untouched and the rethrown error still answers the admin request.
  try {
    const currentRows = await deps.loadReleaseRows(request.shipmentIds);
    // Owner-scoped, per-shipment tolerance: the active run-shipment mapping
    // this run created moments ago re-surfaces in the release queue as
    // already_released. Only a shipment whose active mapping belongs to the
    // run being fenced may tolerate its own marker during this revalidation;
    // every other row keeps its queue eligibility verdict, and an active
    // mapping owned by any other run keeps the release blocked before
    // Stripe payouts.create.
    const fenceActiveMappings = await deps.findActiveShipmentMappings(
      request.shipmentIds,
    );
    if (fenceActiveMappings.some((mapping) => mapping.runId !== run.id)) {
      throw new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409);
    }
    const selfMappedShipmentIds = new Set(
      fenceActiveMappings
        .filter((mapping) => mapping.runId === run.id)
        .map((mapping) => mapping.shipmentId),
    );
    const fenceEligibilityOptions: {
      allowedIneligibleReasons: readonly string[];
      allowedIneligibleReasonsForShipment: (
        shipmentId: string,
      ) => readonly string[];
    } = {
      allowedIneligibleReasons: eligibilityOptions.allowedIneligibleReasons,
      allowedIneligibleReasonsForShipment: (shipmentId) =>
        selfMappedShipmentIds.has(shipmentId)
          ? [...eligibilityOptions.allowedIneligibleReasons, 'already_released']
          : eligibilityOptions.allowedIneligibleReasons.filter(
              (reason) => reason !== 'already_released',
            ),
    };
    assertEligibleRows(
      request.sellerId,
      request.shipmentIds,
      currentRows,
      fenceEligibilityOptions,
    );
    const currentAmount = currentRows.reduce(
      (total, row) => total + row.release_amount_cents,
      0,
    );
    if (currentAmount !== amount) {
      throw new ConnectPayoutReleaseError('PAYOUT_RELEASE_AMOUNT_CHANGED', 409);
    }
    // Actionability drift inside the fence: a destination that turned
    // non-actionable after the first gate must never reach payouts.create.
    await assertAccountActionable(
      deps,
      currentRows[0].stripe_account_id,
    );
  } catch (error) {
    await deps
      .failPayoutCreateFromFence({
        runId: run.id,
        stageVersion: fencedVersion,
        failureReason: toFailureReason(error),
      })
      .catch(() => false);
    throw error;
  }

  try {
    payout = await deps.createStripePayout({
      stripeAccountId: rows[0].stripe_account_id,
      amount,
      currency: 'mxn',
      idempotencyKey: request.idempotencyKey,
      metadata: {
        app_name: 'selene',
        run_id: run.id,
        seller_id: request.sellerId,
        shipment_ids: request.shipmentIds.join(','),
      },
      orderIds: rows
        .map((row) => row.order_id)
        .filter((orderId): orderId is string => Boolean(orderId)),
    });
  } catch (error) {
    const failureReason = toFailureReason(error);
    if (isDefinitiveStripePayoutCreateFailure(error)) {
      // Stripe explicitly rejected the create; no payout object exists, so
      // Phase 2A failed semantics stay authoritative through the fence exit.
      const failed = await deps
        .failPayoutCreateFromFence({
          runId: run.id,
          stageVersion: fencedVersion,
          failureReason,
        })
        .catch(() => false);
      if (failed) {
        throw error;
      }
      // The fence exit lost a race (a newer durable decision consumed the
      // fence): keep that state untouched and surface the Stripe error. The
      // run's durable stage remains the recovery authority.
      throw error;
    }

    // Uncertain outcome: abort the fence into action_required when the exit
    // still holds; otherwise keep the durable fence untouched. Either way a
    // new payout is never created from this state.
    await deps
      .abortPayoutCreateToActionRequired({
        runId: run.id,
        stageVersion: fencedVersion,
        reason: failureReason,
      })
      .catch(() => false);
    throw error;
  }

  try {
    // Exit the fence with the authoritative payout id. FALSE means a webhook
    // projection already consumed the claim/version: this endpoint never
    // writes pending state over a newer durable decision, and the returned
    // payout id still answers the admin request.
    await deps.completePayoutCreateFence({
      runId: run.id,
      stageVersion: fencedVersion,
      stripePayoutId: payout.id,
    });
  } catch (error) {
    // Post-Stripe persistence loss: the guarded sync-fallback RPC parks the
    // run while preserving the durable payout_create_in_progress fence. Its
    // FALSE result means the run already sits in a terminal or newer durable
    // state (e.g. a webhook projected the outcome): the fallback then writes
    // nothing and terminal authority stays untouched. Either way no second
    // write follows, and the original post-Stripe error still answers the
    // request; the future reconciliation path (never a second create)
    // resolves the Stripe outcome.
    await deps
      .markRunPayoutSyncFailed({
        runId: run.id,
        stripePayoutId: payout.id,
        failureReason: toFailureReason(error),
      })
      .catch(() => false);
    throw error;
  }

  return {
    success: true,
    runId: run.id,
    stripePayoutId: payout.id,
    status: 'pending_reconciliation',
    amount,
  };
}

/**
 * Opens the durable write-ahead payout-create fence. A conflict (a fence is
 * already open, the run sits in a non-pre-payout stage, or an executor claim
 * landed after the endpoint's lookups) maps to the reconciliation-required
 * or claim-conflict error: the Stripe outcome of the open fence belongs to
 * reconciliation, never to a second create, and a claimed run belongs to
 * the executor.
 */
async function openPayoutCreateFence(
  deps: ConnectPayoutReleaseDependencies,
  runId: string,
): Promise<number> {
  try {
    return await deps.beginPayoutCreateFence({ runId });
  } catch (error) {
    if (toFailureReason(error).includes('EXECUTOR_CLAIM_HELD')) {
      // The fence RPC atomically refused a run holding an executor claim
      // (live or lapsed); the manual path answers with the same claim
      // conflict semantics the endpoint-level lookups already use.
      throw new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_EXECUTOR_CLAIM_CONFLICT',
        409,
      );
    }
    if (toFailureReason(error).includes('PAYOUT_CREATE_FENCE_CONFLICT')) {
      throw new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      );
    }
    throw error;
  }
}
