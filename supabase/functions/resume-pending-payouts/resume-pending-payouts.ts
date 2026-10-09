/**
 * @file supabase/functions/resume-pending-payouts/resume-pending-payouts.ts
 *
 * Pure orchestration for the Phase 2B awaiting-balance payout executor. The
 * executor continues already-authorized payout runs that are waiting for
 * connected-account funds without a second admin decision:
 *
 *  1. A run is claimed under a token/stage-version lease; the claim gate only
 *     offers pre-payout `awaiting_connected_balance` runs (never a run fenced
 *     in `payout_create_in_progress`) whose account is actionable and whose
 *     next attempt is due.
 *  2. The persisted original admin actor is revalidated; the worker never
 *     substitutes its own identity or takes a second admin decision.
 *  3. Every Stripe call and every worker state write is fenced by the claim
 *     token and the stage version. A stale worker aborts on conflict and a
 *     webhook terminal projection wins over any worker write.
 *  4. Insufficient connected balance defers the run with bounded backoff via
 *     `next_attempt_at`, so the current batch cannot re-claim it and newer
 *     eligible runs keep progressing.
 *  5. A durable `payout_create_in_progress` write-ahead fence is written
 *     BEFORE the Stripe payout create. After any uncertain or post-Stripe
 *     persistence failure the worker NEVER recreates: it reconciles the
 *     existing Stripe payout by server-side listing in the connected-account
 *     context using a bounded `created` window and `metadata.run_id`. Zero or
 *     multiple matches become action_required, not a new payout.
 */
import type { ReleaseQueueRow } from '../release-connect-payout/release-connect-payout.ts';
import type { Database, ConnectPayoutRunShipment } from '../../../packages/types/src/index.ts';

/** Exact deployed reconciliation RPC DTO: intentionally has no shipment_ids. */
export type ReconciliationClaim = Omit<Database['public']['Functions']['fn_claim_payout_create_reconciliation']['Returns'][number], 'stripe_account_id'> & {
  /** SQL LEFT JOIN can return NULL despite generated TABLE-return nullability. */
  stripe_account_id: string | null;
};
export type ReconciliationMapping = Pick<ConnectPayoutRunShipment, 'id' | 'run_id' | 'shipment_id' | 'net_payout' | 'status'>;

export class ResumePayoutsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'ResumePayoutsError';
  }
}

/** Short lease held by the executor while it processes one claimed run. */
export const RESUME_LEASE_SECONDS = 300;

/** Maximum number of runs processed per invocation (per queue). */
export const MAX_RESUME_RUNS_PER_TICK = 5;

/** Stripe create attempts older than this grace are reconciled, not retried. */
export const RECONCILE_GRACE_SECONDS = 600;

/** Bounded insufficient-balance backoff window (seconds). */
export const MIN_DEFER_BACKOFF_SECONDS = 60;
export const MAX_DEFER_BACKOFF_SECONDS = 3600;

export interface ResumeRequestContext {
  method: string;
  suppliedCronSecret: string | null;
  expectedCronSecret: string | null;
}

export function validateResumeRequest(context: ResumeRequestContext): void {
  if (context.method !== 'POST') {
    throw new ResumePayoutsError(400, 'INVALID_REQUEST');
  }

  if (!context.expectedCronSecret) {
    throw new ResumePayoutsError(500, 'INTERNAL_ERROR');
  }

  if (context.suppliedCronSecret !== context.expectedCronSecret) {
    throw new ResumePayoutsError(401, 'CRON_UNAUTHORIZED');
  }
}

/** One claimed run as returned by either claim RPC. */
export interface ClaimedRun {
  run_id: string;
  actor_id: string;
  seller_id: string;
  amount_cents: number;
  idempotency_key: string;
  shipment_ids: string[];
  claim_token: string;
  stage_version: number;
  claim_expires_at: string;
  /** Reconciliation claims only: the seller's connected Stripe account. */
  stripe_account_id?: string | null;
  /** Reconciliation claims only: the durable write-ahead attempt timestamp. */
  payout_create_attempted_at?: string | null;
}

export interface AccountActionabilityState {
  isActionable: boolean;
  blockedReason: string | null;
}

export interface ResumePendingPayoutsDeps {
  claimAwaitingBalanceRun: (input: {
    leaseSeconds: number;
  }) => Promise<ClaimedRun | null>;
  claimPayoutCreateReconciliation: (input: {
    graceSeconds: number;
  }) => Promise<ReconciliationClaim | null>;
  loadReconciliationMappings: (runId: string) => Promise<{
    rows: ReconciliationMapping[];
    /** Exact server count; prevents a truncated Data API page being accepted. */
    total: number | null;
  }>;
  getActorProfile: (actorId: string) => Promise<{ role: string | null } | null>;
  getAccountActionability: (
    sellerId: string,
  ) => Promise<AccountActionabilityState | null>;
  /**
   * Proves the unexpired matching claim token and stage version immediately
   * before every Stripe call and DB transition. Raises STALE_CLAIM,
   * CLAIM_LEASE_EXPIRED, or STAGE_VERSION_CONFLICT; a FALSE result is a stale
   * claim.
   */
  verifyPayoutClaim: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
  }) => Promise<boolean>;
  markRunBlockedByAccount: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
    blockedReason: string | null;
  }) => Promise<boolean>;
  /**
   * Parks a claimed pre-payout run into action_required after a durable
   * drift revalidation (eligibility/dispute/shape) through the guarded stage
   * transition. Token-, version-, and lease-gated; FALSE means a newer
   * decision owns the run.
   */
  transitionRunToActionRequired: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
    reason: string;
  }) => Promise<boolean>;
  loadReleaseRows: (shipmentIds: string[]) => Promise<ReleaseQueueRow[]>;
  /**
   * Defers an insufficient-balance run with bounded backoff. FALSE means the
   * deferral was won by nobody this worker represents (stale claim, lapsed
   * lease, or a newer decision) and the worker must release and skip.
   */
  deferAwaitingBalanceRun: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
  }) => Promise<boolean>;
  beginPayoutCreate: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
  }) => Promise<number>;
  completePayoutCreate: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
    stripePayoutId: string;
  }) => Promise<boolean>;
  failPayoutCreate: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
    failureReason: string;
  }) => Promise<boolean>;
  abortPayoutCreateToActionRequired: (input: {
    runId: string;
    claimToken: string;
    stageVersion: number;
    reason: string;
  }) => Promise<boolean>;
  releasePayoutClaim: (input: {
    runId: string;
    claimToken: string;
  }) => Promise<void>;
  retrieveConnectedBalance: (input: {
    stripeAccountId: string;
  }) => Promise<{ available: Array<{ amount: number; currency: string }> }>;
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
  }) => Promise<{ id: string }>;
  listStripePayoutsForReconciliation: (input: {
    stripeAccountId: string;
    createdGte: string;
  }) => Promise<Array<{ id: string; metadata?: Record<string, unknown> }>>;
}

export type ResumeRunStatus =
  'resumed' | 'deferred' | 'skipped' | 'action_required' | 'error';

export type ResumeRunFailureReason =
  | 'insufficient_balance'
  | 'actor_not_admin'
  | 'account_not_actionable'
  | 'stale_claim'
  | 'claim_lease_expired'
  | 'webhook_terminal_interleaved'
  | 'run_shape_invalid'
  | 'unresolved_create_outcome';

export interface ResumeRunResult {
  runId: string;
  status: ResumeRunStatus;
  reason?: ResumeRunFailureReason;
  stripePayoutId?: string;
  error?: string;
}

export interface ResumeBatchSummary {
  claimed: number;
  resumed: number;
  deferred: number;
  skipped: number;
  actionRequired: number;
  errors: number;
  results: ResumeRunResult[];
}

const MXN_CURRENCY = 'mxn';

function assertNonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ResumePayoutsError(500, 'INVALID_CLAIMED_RUN');
  }
  return value;
}

export function assertClaimedRun(value: unknown): ClaimedRun | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResumePayoutsError(500, 'INVALID_CLAIMED_RUN');
  }

  const record = value as Record<string, unknown>;
  const shipmentIds = record.shipment_ids;
  if (
    !Array.isArray(shipmentIds) ||
    shipmentIds.length === 0 ||
    !shipmentIds.every((id) => typeof id === 'string' && id.trim().length > 0)
  ) {
    throw new ResumePayoutsError(500, 'INVALID_CLAIMED_RUN');
  }

  const amountCents = record.amount_cents;
  if (
    typeof amountCents !== 'number' ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new ResumePayoutsError(500, 'INVALID_CLAIMED_RUN');
  }

  return {
    run_id: assertNonEmptyString(record.run_id),
    actor_id: assertNonEmptyString(record.actor_id),
    seller_id: assertNonEmptyString(record.seller_id),
    amount_cents: amountCents,
    idempotency_key: assertNonEmptyString(record.idempotency_key),
    shipment_ids: (shipmentIds as string[]).map((id) =>
      assertNonEmptyString(id),
    ),
    claim_token: assertNonEmptyString(record.claim_token),
    stage_version:
      typeof record.stage_version === 'number' &&
      Number.isInteger(record.stage_version)
        ? record.stage_version
        : 1,
    claim_expires_at: assertNonEmptyString(record.claim_expires_at),
    stripe_account_id:
      typeof record.stripe_account_id === 'string'
        ? record.stripe_account_id
        : null,
    payout_create_attempted_at:
      typeof record.payout_create_attempted_at === 'string'
        ? record.payout_create_attempted_at
        : null,
  };
}

export function assertReconciliationClaim(value: unknown): ReconciliationClaim | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ResumePayoutsError(500, 'INVALID_CLAIMED_RUN');
  const row = value as Record<string, unknown>;
  if (typeof row.amount_cents !== 'number' || !Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0 ||
      typeof row.stage_version !== 'number' || !Number.isSafeInteger(row.stage_version) || row.stage_version < 1 ||
      typeof row.claim_expires_at !== 'string' || !Number.isFinite(Date.parse(row.claim_expires_at)) ||
      typeof row.payout_create_attempted_at !== 'string' || !Number.isFinite(Date.parse(row.payout_create_attempted_at))) {
    throw new ResumePayoutsError(500, 'INVALID_CLAIMED_RUN');
  }
  return {
    run_id: assertNonEmptyString(row.run_id), actor_id: assertNonEmptyString(row.actor_id),
    seller_id: assertNonEmptyString(row.seller_id), idempotency_key: assertNonEmptyString(row.idempotency_key),
    claim_token: assertNonEmptyString(row.claim_token), amount_cents: row.amount_cents,
    stage_version: row.stage_version, claim_expires_at: row.claim_expires_at,
    stripe_account_id: row.stripe_account_id === null ? null : assertNonEmptyString(row.stripe_account_id),
    payout_create_attempted_at: row.payout_create_attempted_at,
  };
}

async function reconstructReconciliationRun(deps: ResumePendingPayoutsDeps, claim: ReconciliationClaim): Promise<ClaimedRun> {
  const { rows: mappings, total } = await deps.loadReconciliationMappings(claim.run_id);
  const ids = new Set<string>();
  const mappingIds = new Set<string>();
  let amount = 0;
  if (total === null || total !== mappings.length || total < 1) throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
  for (const mapping of mappings) {
    if (mapping.run_id !== claim.run_id || !mapping.shipment_id || !mapping.id || ids.has(mapping.shipment_id) || mappingIds.has(mapping.id) ||
        !['pending_reconciliation', 'reconciliation_needed'].includes(mapping.status) ||
        !Number.isSafeInteger(mapping.net_payout) || mapping.net_payout <= 0) throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    ids.add(mapping.shipment_id);
    mappingIds.add(mapping.id);
    amount += mapping.net_payout;
  }
  if (amount !== claim.amount_cents) throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
  const run = assertClaimedRun({ ...claim, shipment_ids: [...ids] })!;
  const rows = await deps.loadReleaseRows(run.shipment_ids);
  assertRunShapeMatches(run, rows);
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.shipment_id || seen.has(row.shipment_id) || (claim.stripe_account_id !== null && row.stripe_account_id !== claim.stripe_account_id) ||
        mappings.find((mapping) => mapping.shipment_id === row.shipment_id)?.net_payout !== row.release_amount_cents) throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    seen.add(row.shipment_id);
  }
  return run;
}

/**
 * Revalidates the claimed run shape against DB-derived release rows; the
 * persisted amount, seller, shipment set, connected account, and per-shipment
 * transfers must all still agree. All ids are derived from the database; the
 * worker never trusts caller-supplied amounts or keys.
 */
function assertRunShapeMatches(
  claimed: ClaimedRun,
  rows: ReleaseQueueRow[],
): void {
  if (rows.length !== claimed.shipment_ids.length) {
    throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
  }

  const requested = new Set(claimed.shipment_ids);
  let total = 0;
  let stripeAccountId: string | null = null;

  for (const row of rows) {
    if (!row.shipment_id || !requested.has(row.shipment_id)) {
      throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    }
    if (row.seller_id !== claimed.seller_id) {
      throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    }
    if (row.status !== 'completed' || !row.completed_at) {
      throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    }
    if (!row.stripe_account_id || row.stripe_onboarding_status !== 'complete') {
      throw new ResumePayoutsError(500, 'CONNECT_ACCOUNT_NOT_READY');
    }
    if (!row.stripe_transfer_id) {
      throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    }
    if (!row.release_amount_cents || row.release_amount_cents <= 0) {
      throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    }
    if (stripeAccountId && stripeAccountId !== row.stripe_account_id) {
      throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    }
    // Revalidate current release eligibility before the payout create: a
    // shipment that drifted into an active dispute (or any new ineligibility
    // other than the executor's own already-released marker) must abort the
    // claimed run without a Stripe call.
    if (
      row.is_eligible !== true &&
      row.ineligible_reason !== 'already_released'
    ) {
      throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
    }
    stripeAccountId = row.stripe_account_id;
    total += row.release_amount_cents;
  }

  if (total !== claimed.amount_cents) {
    throw new ResumePayoutsError(500, 'RUN_SHAPE_INVALID');
  }
}

function sumAvailableMxn(
  entries: Array<{ amount: number; currency: string }>,
): number {
  return entries.reduce(
    (total, entry) =>
      entry.currency === MXN_CURRENCY ? total + entry.amount : total,
    0,
  );
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyStaleClaim(
  error: unknown,
): 'stale_claim' | 'claim_lease_expired' | null {
  const text = toErrorText(error);
  if (text.includes('CLAIM_LEASE_EXPIRED')) return 'claim_lease_expired';
  if (text.includes('STALE_CLAIM')) return 'stale_claim';
  return null;
}

/**
 * Proves the unexpired matching claim token and stage version immediately
 * before a Stripe call or DB transition. Any mismatch raises; the caller must
 * abort without a Stripe call and without a state write.
 */
async function assertLiveClaim(
  deps: ResumePendingPayoutsDeps,
  claimed: ClaimedRun,
  stageVersion: number,
): Promise<void> {
  const live = await deps.verifyPayoutClaim({
    runId: claimed.run_id,
    claimToken: claimed.claim_token,
    stageVersion,
  });
  if (!live) {
    throw new Error('STALE_CLAIM');
  }
}

/**
 * Parks a claimed pre-payout run into action_required after a durable drift
 * revalidation (eligibility, dispute, or shape change). The park is a
 * token-, version-, and lease-gated transition; when it wins nothing the
 * worker releases its claim and skips instead of touching a newer decision.
 */
async function parkRunForDrift(
  deps: ResumePendingPayoutsDeps,
  claimed: ClaimedRun,
  reason: string,
): Promise<ResumeRunResult> {
  try {
    const parked = await deps.transitionRunToActionRequired({
      runId: claimed.run_id,
      claimToken: claimed.claim_token,
      stageVersion: claimed.stage_version,
      reason,
    });
    if (parked) {
      return {
        runId: claimed.run_id,
        status: 'action_required',
        reason: 'run_shape_invalid',
      };
    }
    await releaseClaimSafe(deps, claimed);
    return {
      runId: claimed.run_id,
      status: 'skipped',
      reason: 'stale_claim',
    };
  } catch (transitionError: unknown) {
    await releaseClaimSafe(deps, claimed);
    const stale = classifyStaleClaim(transitionError);
    return stale
      ? {
          runId: claimed.run_id,
          status: 'skipped',
          reason: stale,
        }
      : {
          runId: claimed.run_id,
          status: 'error',
          error: toErrorText(transitionError),
        };
  }
}

function isDefinitiveStripePayoutCreateFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const raw =
    record.raw && typeof record.raw === 'object'
      ? (record.raw as Record<string, unknown>)
      : undefined;
  const type = record.type;
  const code = record.code ?? raw?.code;
  const statusCode = record.statusCode ?? raw?.statusCode;

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

function releaseClaimSafe(
  deps: ResumePendingPayoutsDeps,
  claimed: ClaimedRun,
): Promise<void> {
  return deps
    .releasePayoutClaim({
      runId: claimed.run_id,
      claimToken: claimed.claim_token,
    })
    .catch(() => {
      // Best-effort release; the lease expiry is the fallback.
    });
}

/**
 * Aborts a fenced run into action_required through the guarded fence exit.
 * When the token-, version-, and lease-conditional abort wins nothing, a
 * newer decision owns the run: the worker releases and skips instead of
 * reporting a park it did not win.
 */
async function abortFencedRunToActionRequired(
  deps: ResumePendingPayoutsDeps,
  claimed: ClaimedRun,
  reason: string,
): Promise<ResumeRunResult> {
  const aborted = await deps.abortPayoutCreateToActionRequired({
    runId: claimed.run_id,
    claimToken: claimed.claim_token,
    stageVersion: claimed.stage_version,
    reason,
  });
  if (!aborted) {
    await releaseClaimSafe(deps, claimed);
    return {
      runId: claimed.run_id,
      status: 'skipped',
      reason: 'stale_claim',
    };
  }
  return {
    runId: claimed.run_id,
    status: 'action_required',
    reason: 'unresolved_create_outcome',
  };
}

/**
 * Reconciles the Stripe outcome for a fenced run by listing payouts in the
 * connected-account context with a bounded `created` window anchored on the
 * durable attempt timestamp and filtered by `metadata.run_id`. Exactly one
 * match completes the fence; zero or multiple matches become action_required.
 * This path must never call payouts.create again.
 */
async function reconcileFencedPayoutCreate(
  deps: ResumePendingPayoutsDeps,
  claimed: ClaimedRun,
  stripeAccountId: string | null | undefined,
): Promise<ResumeRunResult> {
  const attemptedAt = claimed.payout_create_attempted_at;
  if (!stripeAccountId) {
    // Without the account context the outcome cannot be reconciled safely:
    // admin decision, never a new payout.
    return await abortFencedRunToActionRequired(
      deps,
      claimed,
      'PAYOUT_CREATE_RECONCILIATION_CONTEXT_MISSING',
    );
  }

  // Prove the live claim immediately before the Stripe listing call; a stale
  // claim aborts without any Stripe call and without a state write.
  await assertLiveClaim(deps, claimed, claimed.stage_version);

  // The reconciliation window is bounded by the durable create attempt: the
  // fence wrote payout_create_attempted_at before the create; an immediate
  // reconcile anchors at the attempt it just made.
  const createdGte = attemptedAtIsValid(attemptedAt)
    ? (attemptedAt as string)
    : new Date().toISOString();

  const listed = await deps.listStripePayoutsForReconciliation({
    stripeAccountId,
    createdGte,
  });
  const matches = listed.filter(
    (payout) =>
      payout.metadata &&
      typeof payout.metadata === 'object' &&
      payout.metadata.run_id === claimed.run_id,
  );

  if (matches.length === 1) {
    const completed = await deps.completePayoutCreate({
      runId: claimed.run_id,
      claimToken: claimed.claim_token,
      stageVersion: claimed.stage_version,
      stripePayoutId: matches[0].id,
    });
    if (completed) {
      return {
        runId: claimed.run_id,
        status: 'resumed',
        stripePayoutId: matches[0].id,
      };
    }
    return {
      runId: claimed.run_id,
      status: 'skipped',
      reason: 'webhook_terminal_interleaved',
    };
  }

  // Zero or multiple matches: action_required, not a new payout.
  return await abortFencedRunToActionRequired(
    deps,
    claimed,
    `PAYOUT_CREATE_RECONCILIATION_MATCHES:${matches.length}`,
  );
}

function attemptedAtIsValid(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

async function processCreateClaim(
  deps: ResumePendingPayoutsDeps,
  claimed: ClaimedRun,
): Promise<ResumeRunResult> {
  // Revalidate the persisted original admin actor. The worker never
  // substitutes its own identity or takes a second admin decision.
  const actor = await deps.getActorProfile(claimed.actor_id);
  if (actor?.role !== 'admin') {
    await releaseClaimSafe(deps, claimed);
    return {
      runId: claimed.run_id,
      status: 'skipped',
      reason: 'actor_not_admin',
    };
  }

  // Derived account actionability: a documented non-actionable bank status or
  // disabled payouts flag parks the run in action_required before any Stripe
  // call. An undetermined state never blocks (the SQL claim gate already
  // excluded accounts with recorded non-actionable evidence).
  const actionability = await deps.getAccountActionability(claimed.seller_id);
  if (actionability?.blockedReason != null) {
    const parked = await deps.markRunBlockedByAccount({
      runId: claimed.run_id,
      claimToken: claimed.claim_token,
      stageVersion: claimed.stage_version,
      blockedReason: actionability.blockedReason,
    });
    if (!parked) {
      // The token-, version-, and lease-gated park won nothing: a newer
      // decision owns the run, so this worker releases and skips.
      await releaseClaimSafe(deps, claimed);
      return {
        runId: claimed.run_id,
        status: 'skipped',
        reason: 'stale_claim',
      };
    }
    return {
      runId: claimed.run_id,
      status: 'action_required',
      reason: 'account_not_actionable',
    };
  }

  // Revalidate the run against DB-derived release rows; every id, amount, and
  // the persisted idempotency key come from the database. Durable drift — a
  // new active dispute or any current-eligibility change since the claim —
  // parks the run action_required through the guarded transition: Stripe is
  // never consulted on a drifted run.
  let rows: ReleaseQueueRow[];
  try {
    rows = await deps.loadReleaseRows(claimed.shipment_ids);
    assertRunShapeMatches(claimed, rows);
  } catch (error: unknown) {
    if (
      error instanceof ResumePayoutsError &&
      (error.code === 'RUN_SHAPE_INVALID' ||
        error.code === 'CONNECT_ACCOUNT_NOT_READY')
    ) {
      return await parkRunForDrift(deps, claimed, error.code);
    }
    throw error;
  }
  const stripeAccountId = rows[0].stripe_account_id as string;

  // Prove the unexpired matching claim immediately before the Stripe balance
  // call; an expired or stale claim aborts with no Stripe call and no state
  // regression.
  try {
    await assertLiveClaim(deps, claimed, claimed.stage_version);
  } catch (error: unknown) {
    const stale = classifyStaleClaim(error);
    if (stale) {
      await releaseClaimSafe(deps, claimed);
      return {
        runId: claimed.run_id,
        status: 'skipped',
        reason: stale,
      };
    }
    throw error;
  }

  // Insufficient connected balance defers with bounded backoff; the current
  // batch cannot re-claim the run and newer eligible runs keep progressing.
  const balance = await deps.retrieveConnectedBalance({
    stripeAccountId,
  });
  const available = sumAvailableMxn(balance.available);
  if (available < claimed.amount_cents) {
    const deferred = await deps.deferAwaitingBalanceRun({
      runId: claimed.run_id,
      claimToken: claimed.claim_token,
      stageVersion: claimed.stage_version,
    });
    if (!deferred) {
      // The token-, version-, and lease-gated deferral was not won: report no
      // deferral, release the claim, and let the claim flow decide again.
      await releaseClaimSafe(deps, claimed);
      return {
        runId: claimed.run_id,
        status: 'skipped',
        reason: 'stale_claim',
      };
    }
    return {
      runId: claimed.run_id,
      status: 'deferred',
      reason: 'insufficient_balance',
    };
  }

  // Durable write-ahead fence BEFORE the Stripe create call.
  let fencedVersion: number;
  try {
    fencedVersion = await deps.beginPayoutCreate({
      runId: claimed.run_id,
      claimToken: claimed.claim_token,
      stageVersion: claimed.stage_version,
    });
  } catch (error: unknown) {
    // A stale claim token or a lost race: the worker aborts without calling
    // Stripe.
    await releaseClaimSafe(deps, claimed);
    const stale = toErrorText(error).includes('STALE_CLAIM');
    return {
      runId: claimed.run_id,
      status: stale ? 'skipped' : 'error',
      reason: stale ? 'stale_claim' : undefined,
      error: stale ? undefined : toErrorText(error),
    };
  }

  let payout: { id: string };
  try {
    // Prove the live claim again immediately before the Stripe create: the
    // lease may have lapsed while the fence was opening.
    try {
      await assertLiveClaim(deps, claimed, fencedVersion);
    } catch (error: unknown) {
      const stale = classifyStaleClaim(error);
      if (stale) {
        await releaseClaimSafe(deps, claimed);
        return {
          runId: claimed.run_id,
          status: 'skipped',
          reason: stale,
        };
      }
      // The fence stays durable; reconciliation resolves it next tick.
      await releaseClaimSafe(deps, claimed).catch(() => undefined);
      return {
        runId: claimed.run_id,
        status: 'error',
        error: toErrorText(error),
      };
    }

    payout = await deps.createStripePayout({
      stripeAccountId,
      amount: claimed.amount_cents,
      currency: MXN_CURRENCY,
      // The persisted Stripe idempotency key is reused exactly; the worker
      // never derives a new payout key.
      idempotencyKey: claimed.idempotency_key,
      metadata: {
        app_name: 'selene',
        run_id: claimed.run_id,
        seller_id: claimed.seller_id,
        shipment_ids: claimed.shipment_ids.join(','),
      },
    });
  } catch (error: unknown) {
    if (isDefinitiveStripePayoutCreateFailure(error)) {
      // Stripe explicitly rejected the create; no payout object exists, so
      // Phase 2A failed semantics stay authoritative and the admin retry flow
      // remains the recovery path.
      const failed = await deps
        .failPayoutCreate({
          runId: claimed.run_id,
          claimToken: claimed.claim_token,
          stageVersion: fencedVersion,
          failureReason: toErrorText(error),
        })
        .catch(() => false);
      if (!failed) {
        // The fence exit itself failed: reconcile instead of recreating, from
        // the fenced version this worker actually holds.
        return await reconcileFencedPayoutCreate(
          deps,
          { ...claimed, stage_version: fencedVersion },
          stripeAccountId,
        );
      }
      await releaseClaimSafe(deps, claimed);
      return {
        runId: claimed.run_id,
        status: 'error',
        error: toErrorText(error),
      };
    }

    // Uncertain outcome (connection error, 5xx, timeout): never recreate.
    // The durable fence stays written, so reconciliation resolves the
    // existing Stripe payout without a second create.
    try {
      return await reconcileFencedPayoutCreate(
        deps,
        { ...claimed, stage_version: fencedVersion },
        stripeAccountId,
      );
    } catch (reconcileError: unknown) {
      // The fence stays durable; the next tick reconciles via the bounded
      // reconciliation claim.
      await releaseClaimSafe(deps, claimed);
      return {
        runId: claimed.run_id,
        status: 'error',
        error: toErrorText(reconcileError),
      };
    }
  }

  try {
    const completed = await deps.completePayoutCreate({
      runId: claimed.run_id,
      claimToken: claimed.claim_token,
      stageVersion: fencedVersion,
      stripePayoutId: payout.id,
    });
    if (!completed) {
      // A webhook terminal projection consumed the claim while the worker was
      // in flight; the worker must not write pending over it.
      return {
        runId: claimed.run_id,
        status: 'skipped',
        reason: 'webhook_terminal_interleaved',
        stripePayoutId: payout.id,
      };
    }
    return {
      runId: claimed.run_id,
      status: 'resumed',
      stripePayoutId: payout.id,
    };
  } catch (error: unknown) {
    // Post-Stripe persistence failure: the run stays durably fenced in
    // payout_create_in_progress; the next tick reconciles and can never call
    // create again.
    await releaseClaimSafe(deps, claimed).catch(() => undefined);
    return {
      runId: claimed.run_id,
      status: 'error',
      error: toErrorText(error),
    };
  }
}

export async function resumePendingPayoutRuns(
  deps: ResumePendingPayoutsDeps,
): Promise<ResumeBatchSummary> {
  const results: ResumeRunResult[] = [];

  // 1. Bounded batch of create-eligible awaiting-balance runs.
  for (let index = 0; index < MAX_RESUME_RUNS_PER_TICK; index += 1) {
    const claimed = assertClaimedRun(
      await deps.claimAwaitingBalanceRun({
        leaseSeconds: RESUME_LEASE_SECONDS,
      }),
    );
    if (!claimed) break;

    try {
      results.push(await processCreateClaim(deps, claimed));
    } catch (error: unknown) {
      // Validation or unexpected failure: release the claim and record it.
      await releaseClaimSafe(deps, claimed);
      results.push({
        runId: claimed.run_id,
        status: 'error',
        error: toErrorText(error),
      });
    }
  }

  // 2. Bounded reconciliation of stale payout-create fences: never a create,
  // always a server-side listing reconciliation.
  for (let index = 0; index < MAX_RESUME_RUNS_PER_TICK; index += 1) {
    const claim = assertReconciliationClaim(
      await deps.claimPayoutCreateReconciliation({
        graceSeconds: RECONCILE_GRACE_SECONDS,
      }),
    );
    if (!claim) break;

    try {
      const claimed = await reconstructReconciliationRun(deps, claim);
      results.push(
        await reconcileFencedPayoutCreate(
          deps,
          claimed,
          claimed.stripe_account_id,
        ),
      );
    } catch (error: unknown) {
      const stale = classifyStaleClaim(error);
      // Token-only cleanup cannot clear a newer claim; no mapping/park write.
      await deps.releasePayoutClaim({ runId: claim.run_id, claimToken: claim.claim_token }).catch(() => undefined);
      results.push(
        stale
          ? {
              runId: claim.run_id,
              status: 'skipped',
              reason: stale,
            }
          : {
              runId: claim.run_id,
              status: 'error',
              error: toErrorText(error),
            },
      );
    }
  }

  return summarizeResumeResults(results);
}

export function summarizeResumeResults(
  results: readonly ResumeRunResult[],
): ResumeBatchSummary {
  const summary: ResumeBatchSummary = {
    claimed: results.length,
    resumed: 0,
    deferred: 0,
    skipped: 0,
    actionRequired: 0,
    errors: 0,
    results: [...results],
  };

  for (const result of results) {
    switch (result.status) {
      case 'resumed':
        summary.resumed += 1;
        break;
      case 'deferred':
        summary.deferred += 1;
        break;
      case 'skipped':
        summary.skipped += 1;
        break;
      case 'action_required':
        summary.actionRequired += 1;
        break;
      default:
        summary.errors += 1;
    }
  }

  return summary;
}
