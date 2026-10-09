export type ConnectPayoutRunStatus =
  | 'pending_reconciliation'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'reconciliation_needed';

export type StripePayoutStatus =
  | 'pending'
  | 'in_transit'
  | 'paid'
  | 'failed'
  | 'canceled';

export type ConnectPayoutEventType =
  | 'payout.created'
  | 'payout.updated'
  | 'payout.paid'
  | 'payout.failed'
  | 'payout.canceled';

export interface ConnectPayoutRunForReconciliation {
  id: string;
  status: ConnectPayoutRunStatus | string;
  stripe_payout_id: string | null;
  seller_id: string | null;
  paid_at: string | null;
}

export interface ConnectPayoutEventEvidenceInput {
  eventId: string;
  eventType: ConnectPayoutEventType;
  payoutId: string;
  runId: string;
  stripeCreatedAt: string;
  observedStatus: StripePayoutStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  failureBalanceTransaction?: string | null;
}

export interface ConnectPayoutReconciliationInput {
  eventId: string;
  eventType: ConnectPayoutEventType;
  payoutId: string;
  metadataRunId?: string | null;
  occurredAt: string;
  observedStatus: StripePayoutStatus;
  failureReason?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  failureBalanceTransaction?: string | null;
}

export interface ConnectPayoutAuthorityState {
  status: StripePayoutStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  failureBalanceTransaction?: string | null;
}

export interface ConnectPayoutReconciliationDeps {
  findRunForPayout: (input: {
    payoutId: string;
    metadataRunId?: string | null;
  }) => Promise<ConnectPayoutRunForReconciliation | null>;
  appendEventEvidence: (
    input: ConnectPayoutEventEvidenceInput,
  ) => Promise<boolean>;
  /**
   * Phase 2B final slice: the ONLY terminal outcome write. One atomic,
   * guarded SECURITY DEFINER RPC unit conditionally projects the run (status
   * + compatible stage), the shipment mappings (monotonic filter), and the
   * shipment payout-id set/clear in the same transaction. TRUE = accepted
   * (all effects applied); FALSE = refused (payout id mismatch, a concurrent
   * writer consumed the run, or the outcome would regress terminal
   * authority) — there is no dependent write for the webhook to apply after
   * a refusal, ever.
   */
  markRunStatus: (input: {
    runId: string;
    payoutId: string;
    status: Exclude<
      ConnectPayoutRunStatus,
      'pending_reconciliation' | 'reconciliation_needed'
    >;
    occurredAt: string;
    failureReason?: string | null;
    failureBalanceTransaction?: string | null;
  }) => Promise<boolean>;
  markRunReconciliationNeeded: (input: {
    runId: string;
    failureReason: string;
  }) => Promise<void>;
  /**
   * Phase 2B: advances the pre-terminal aggregate stage from signed
   * payout.created / payout.updated(in_transit) events. Returns FALSE when
   * the guarded projection refuses the progression (terminal run, or a
   * monotonic regression such as in_transit → payout_pending); TRUE means
   * the stage now equals the target, whether it was written here or the run
   * already sat at it. Optional so Phase 2A deployments without stage support
   * keep working unchanged.
   */
  projectPayoutStage?: (input: {
    runId: string;
    targetStage: 'payout_pending' | 'payout_in_transit';
  }) => Promise<boolean>;
  decideRejectedPayoutStagePark?: (input: {
    runId: string;
    payoutId: string;
    targetStage: 'payout_pending' | 'payout_in_transit';
    failureReason: string;
    eventId: string;
  }) => Promise<'superseded_paid' | 'superseded_failed' | 'parked' | 'identity_conflict'>;
  attachRunPayoutId: (input: {
    runId: string;
    stripePayoutId: string;
    sellerId: string | null;
  }) => Promise<void>;
  getSellerStripeAccountId: (
    sellerId: string | null,
  ) => Promise<string | null>;
  resolveAuthoritativePayout: (input: {
    payoutId: string;
    stripeAccountId: string | null;
  }) => Promise<ConnectPayoutAuthorityState>;
}

export type ConnectPayoutReconciliationResult =
  | { status: 'ignored'; reason: 'run_not_found' | 'payout_id_mismatch' }
  | { status: 'duplicate_event'; runId: string }
  | { status: 'evidence_recorded'; runId: string }
  | { status: 'already_reconciled'; runId: string }
  | { status: 'reconciled'; runId: string }
  | { status: 'reconciliation_needed'; runId: string };

type TerminalRunStatus = Exclude<
  ConnectPayoutRunStatus,
  'pending_reconciliation' | 'reconciliation_needed'
>;

function toFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecoverableMissingPayoutIdStatus(status: string): boolean {
  return (
    status === 'pending_reconciliation' || status === 'reconciliation_needed'
  );
}

function isTerminalRunStatus(status: string): status is TerminalRunStatus {
  return status === 'paid' || status === 'failed' || status === 'canceled';
}

/**
 * Maps an ingested payout event to the aggregate run status it projects, or
 * null when the event is evidence-only (no Stripe payout state exists yet, or
 * the observed state has no Selene aggregate stage in Phase 2A).
 */
function toProjectionTarget(
  input: ConnectPayoutReconciliationInput,
): TerminalRunStatus | null {
  if (input.eventType === 'payout.created') return null;

  const observed = input.observedStatus;
  if (observed === 'paid') return 'paid';
  if (observed === 'failed') return 'failed';
  if (observed === 'canceled') return 'canceled';
  return null;
}

export async function reconcileConnectPayoutEvent(
  input: ConnectPayoutReconciliationInput,
  deps: ConnectPayoutReconciliationDeps,
): Promise<ConnectPayoutReconciliationResult> {
  const run = await deps.findRunForPayout({
    payoutId: input.payoutId,
    metadataRunId: input.metadataRunId,
  });

  if (!run) return { status: 'ignored', reason: 'run_not_found' };

  if (run.stripe_payout_id === null) {
    if (
      !input.metadataRunId ||
      input.metadataRunId !== run.id ||
      !isRecoverableMissingPayoutIdStatus(run.status)
    ) {
      return { status: 'ignored', reason: 'payout_id_mismatch' };
    }

    try {
      await deps.attachRunPayoutId({
        runId: run.id,
        stripePayoutId: input.payoutId,
        sellerId: run.seller_id,
      });
    } catch (error) {
      try {
        await deps.markRunReconciliationNeeded({
          runId: run.id,
          failureReason: toFailureReason(error),
        });
      } finally {
        // No ledger row exists yet; Stripe must retry even if parking fails.
        throw error;
      }
    }
  } else if (run.stripe_payout_id !== input.payoutId) {
    return { status: 'ignored', reason: 'payout_id_mismatch' };
  }

  const evidence: ConnectPayoutEventEvidenceInput = {
    eventId: input.eventId,
    eventType: input.eventType,
    payoutId: input.payoutId,
    runId: run.id,
    stripeCreatedAt: input.occurredAt,
    observedStatus: input.observedStatus,
    failureCode: input.failureCode ?? null,
    failureMessage: input.failureMessage ?? input.failureReason ?? null,
    failureBalanceTransaction: input.failureBalanceTransaction ?? null,
  };

  let appended: boolean;
  try {
    appended = await deps.appendEventEvidence(evidence);
  } catch (error) {
    try {
      await deps.markRunReconciliationNeeded({
        runId: run.id,
        failureReason: toFailureReason(error),
      });
    } finally {
      // Failed append has no replay evidence; preserve the original error.
      throw error;
    }
  }

  const targetStatus = toProjectionTarget(input);

  if (!appended) {
    if (toProgressStage(input) && deps.projectPayoutStage) {
      // Evidence may have committed before the decision RPC failed. Retry the
      // idempotent stage projection and locked decision without re-inserting it.
      return projectProgressEvent(run.id, input, deps);
    }
    if (run.status === 'reconciliation_needed' && targetStatus !== null) {
      // The evidence row was retained by an earlier delivery whose projection
      // failed partway: rebuild the projection from this same event without
      // inserting a second evidence record.
      return await replayProjectionForDuplicate({
        run,
        targetStatus,
        input,
        deps,
      });
    }
    return { status: 'duplicate_event', runId: run.id };
  }

  if (targetStatus === null) {
    // Phase 2B: advance the pre-terminal aggregate stage when the signed
    // event documents a progression. payout.created maps to payout_pending
    // (no Stripe payout state exists before creation), and an in_transit
    // update maps to payout_in_transit; a terminal run stays terminal.
    return projectProgressEvent(run.id, input, deps);
  }

  if (isTerminalRunStatus(run.status)) {
    try {
      return await resolveTerminalProjection({
        runId: run.id,
        runStatus: run.status,
        paidAt: run.paid_at,
        sellerId: run.seller_id,
        targetStatus,
        input,
        deps,
      });
    } catch (error) {
      await deps.markRunReconciliationNeeded({
        runId: run.id,
        failureReason: toFailureReason(error),
      });
      return { status: 'reconciliation_needed', runId: run.id };
    }
  }

  try {
    await applyProjection({
      runId: run.id,
      targetStatus,
      input,
      deps,
    });
    return { status: 'reconciled', runId: run.id };
  } catch (error) {
    await deps.markRunReconciliationNeeded({
      runId: run.id,
      failureReason: toFailureReason(error),
    });
    return { status: 'reconciliation_needed', runId: run.id };
  }
}

async function projectProgressEvent(
  runId: string,
  input: ConnectPayoutReconciliationInput,
  deps: ConnectPayoutReconciliationDeps,
): Promise<ConnectPayoutReconciliationResult> {
  const targetStage = toProgressStage(input);
  if (!targetStage || !deps.projectPayoutStage) {
    return { status: 'evidence_recorded', runId };
  }

  let projected: boolean;
  try {
    projected = await deps.projectPayoutStage({ runId, targetStage });
  } catch (error) {
    if (toFailureReason(error) === 'PAYOUT_STAGE_PROJECTION_CONFLICT') {
      projected = false;
    } else {
      await deps.markRunReconciliationNeeded({ runId, failureReason: toFailureReason(error) });
      return { status: 'reconciliation_needed', runId };
    }
  }

  if (projected === false && deps.decideRejectedPayoutStagePark) {
    // Deliberately outside the projection catch: a failed decision must
    // propagate for webhook retry, never invoke an unfenced run-ID park.
    const decision = await deps.decideRejectedPayoutStagePark({
      runId, payoutId: input.payoutId, targetStage,
      failureReason: 'PAYOUT_STAGE_PROJECTION_CONFLICT', eventId: input.eventId,
    });
    return { status: decision === 'superseded_paid' || decision === 'superseded_failed' ? 'evidence_recorded' : 'reconciliation_needed', runId };
  }
  return { status: 'evidence_recorded', runId };
}

/**
 * Rebuilds the aggregate projection for a duplicate event whose earlier
 * projection failed partway: the evidence row is already retained and the run
 * is in reconciliation_needed, so the same signed event re-applies the
 * outcome idempotently without a second evidence insert or new money
 * movement. Safety relies on run.paid_at persisting after a run leaves paid:
 * replayed paid events never release shipments, and downgrade replays
 * re-run the same terminal paid-run gates (occurrence order, Stripe
 * authority) as the first attempt.
 */
async function replayProjectionForDuplicate(context: {
  run: ConnectPayoutRunForReconciliation;
  targetStatus: TerminalRunStatus;
  input: ConnectPayoutReconciliationInput;
  deps: ConnectPayoutReconciliationDeps;
}): Promise<ConnectPayoutReconciliationResult> {
  const { run, targetStatus, input, deps } = context;
  const runId = run.id;

  try {
    if (targetStatus === 'paid') {
      // A parked run can retain paid_at after a later failure. Neither a
      // completed projection nor a safe release follows from that timestamp;
      // leave operator reconciliation visible without invoking the paid RPC.
      return { status: 'reconciliation_needed', runId };
    }

    if (run.paid_at !== null) {
      // A downgrade from paid failed partway. paid_at persists, so replay
      // re-runs the same terminal paid-run gates: occurrence order decides
      // the direct late-failure downgrade, otherwise Stripe authority does.
      return await resolveTerminalProjection({
        runId,
        runStatus: 'paid',
        paidAt: run.paid_at,
        sellerId: run.seller_id,
        targetStatus,
        input,
        deps,
      });
    }

    // The run never reached paid, so its shipments were never released for
    // this payout: re-apply the outcome forward without touching release
    // markings.
    await applyProjection({
      runId,
      targetStatus,
      input,
      deps,
    });
    return { status: 'reconciled', runId };
  } catch (error) {
    await deps.markRunReconciliationNeeded({
      runId,
      failureReason: toFailureReason(error),
    });
    return { status: 'reconciliation_needed', runId };
  }
}

/**
 * Maps a payout.created event or an in_transit payout.updated event to the
 * pre-terminal Selene aggregate stage it advances, or null when the event
 * carries no documented progress state.
 */
function toProgressStage(
  input: ConnectPayoutReconciliationInput,
): 'payout_pending' | 'payout_in_transit' | null {
  if (input.eventType === 'payout.created') return 'payout_pending';
  if (input.eventType === 'payout.updated' && input.observedStatus === 'in_transit') {
    return 'payout_in_transit';
  }
  return null;
}

export type AccountActionabilityKind =
  | 'account_updated'
  | 'external_account_updated';

export interface AccountActionabilityInput {
  kind: AccountActionabilityKind;
  accountId: string | null;
  /** External bank account id carried by the signed event, when parseable. */
  externalAccountId: string | null;
  payoutsEnabled: boolean | null;
  externalAccountStatus: string | null;
}

export interface AccountActionabilityResolution {
  actionable: boolean;
  blockedReason: string | null;
  undetermined: boolean;
}

/**
 * Documented non-actionable external-account statuses: payout creation is
 * blocked while the bank account holds one of these states.
 */
const NON_ACTIONABLE_EXTERNAL_ACCOUNT_STATUSES: readonly string[] = [
  'errored',
  'verification_failed',
  'tokenized_account_number_deactivated',
];

/**
 * Classifies HISTORICAL signed evidence only. This classification must never
 * gate current payouts; applyConnectAccountActionability independently reads
 * the authoritative account and complete bank list, even when undetermined.
 */
export function resolveAccountActionability(
  input: AccountActionabilityInput,
): AccountActionabilityResolution {
  const { accountId, payoutsEnabled, externalAccountStatus } = input;

  if (!accountId) {
    return { actionable: false, blockedReason: null, undetermined: true };
  }

  if (payoutsEnabled === null && externalAccountStatus === null) {
    // Undetermined: no documented evidence about payout ability.
    return { actionable: false, blockedReason: null, undetermined: true };
  }

  if (payoutsEnabled === false) {
    return {
      actionable: false,
      blockedReason: 'payouts_disabled',
      undetermined: false,
    };
  }

  if (
    externalAccountStatus !== null &&
    NON_ACTIONABLE_EXTERNAL_ACCOUNT_STATUSES.includes(externalAccountStatus)
  ) {
    return {
      actionable: false,
      blockedReason: externalAccountStatus,
      undetermined: false,
    };
  }

  if (payoutsEnabled === true) {
    // Historical account-level evidence only, not a current destination gate.
    return { actionable: true, blockedReason: null, undetermined: false };
  }

  // A status string Stripe does not document with Selene-safe payout
  // semantics: never block on it, and never treat it as healthy evidence.
  return { actionable: false, blockedReason: null, undetermined: true };
}

/**
 * Defensively extracts the documented actionability fields from the ACTUAL
 * signed Stripe event shape. Never casts `event.data.object` to
 * Stripe.Account:
 *
 *  - `account.updated` carries the account object: `id` is the connected
 *    account, and `external_accounts` is a Stripe LIST object whose bank
 *    entries live under `data` (not a raw array).
 *  - External-account created/updated/deleted events carry the bank object;
 *    `account` (string or expanded Account), not its bank `id`, identifies the
 *    connected account. Signed object/envelope identities must agree.
 *
 * Missing historical fields remain null. A parseable identity still triggers
 * current-state reconciliation; an invalid/conflicting identity is refused.
 */
export function extractSignedAccountEventData(input: {
  eventType: string;
  dataObject: unknown;
  /**
   * Signed event envelope identity must agree with any documented object
   * identity; it is the fallback only when object ownership is absent.
   */
  eventAccount?: string | null;
}): AccountActionabilityInput | null {
  const object = input.dataObject;
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return null;
  }
  const record = object as Record<string, unknown>;

  const isExternalAccountEvent = [
    'account.external_account.created',
    'account.external_account.updated',
    'account.external_account.deleted',
  ].includes(input.eventType);
  if (!isExternalAccountEvent && input.eventType !== 'account.updated') return null;

  const objectIdentity = isExternalAccountEvent ? record.account : record.id;
  const documentedAccountId = normalizeStripeAccountId(objectIdentity);
  if (objectIdentity != null && !documentedAccountId) return null;

  // The signed envelope may supply absent ownership, never contradict it or
  // promote the bank object's own id into a connected-account identity.
  const eventAccountFallback = normalizeStripeAccountId(input.eventAccount);
  if (input.eventAccount != null && !eventAccountFallback) return null;
  if (documentedAccountId && eventAccountFallback && documentedAccountId !== eventAccountFallback) return null;
  const accountId = documentedAccountId ?? eventAccountFallback;

  if (!accountId) return null;

  const kind: AccountActionabilityKind = isExternalAccountEvent
    ? 'external_account_updated'
    : 'account_updated';

  const payoutsEnabledRaw = isExternalAccountEvent
    ? undefined
    : record.payouts_enabled;
  const payoutsEnabled =
    typeof payoutsEnabledRaw === 'boolean' ? payoutsEnabledRaw : null;

  let externalAccountId: string | null = null;
  let externalAccountStatus: string | null = null;
  if (isExternalAccountEvent) {
    // The event object IS the bank account; its id is the external account.
    if (typeof record.id === 'string' && record.id.length > 0) {
      externalAccountId = record.id;
    }
    if (typeof record.status === 'string' && record.status.length > 0) {
      externalAccountStatus = record.status;
    }
  } else {
    // account.updated: external_accounts is a Stripe list object; accept a
    // raw array defensively, but never a non-list, non-array shape. Only
    // documented bank-account entries contribute evidence: a card entry's
    // status never gates payout actionability.
    //
    // Destination selection (stripe@17.0.0 BankAccount type): the bank
    // account documents `default_for_currency` ("Whether this bank account
    // is the default external account for its currency") and the account
    // documents `default_currency` (the account's payout currency — MXN for
    // Selene sellers). Status evidence only comes from the established
    // default payout destination: an arbitrary first entry — and in
    // particular an unrelated non-default errored bank account — must never
    // falsely mark the seller non-actionable. When no default can be
    // established (no default_for_currency flag, or multiple defaults with
    // no documented account currency to disambiguate), status evidence stays
    // undetermined.
    const externalAccounts = record.external_accounts;
    const listEntries = Array.isArray(externalAccounts)
      ? (externalAccounts as unknown[])
      : externalAccounts &&
          typeof externalAccounts === 'object' &&
          Array.isArray((externalAccounts as { data?: unknown }).data)
        ? ((externalAccounts as { data: unknown[] }).data as unknown[])
        : [];
    const bankEntries: Array<{
      id: string;
      status: string | null;
      currency: string | null;
    }> = [];
    for (const entry of listEntries) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const bankEntry = entry as {
          id?: unknown;
          object?: unknown;
          status?: unknown;
          currency?: unknown;
          default_for_currency?: unknown;
        };
        if (bankEntry.object !== 'bank_account') continue;
        if (typeof bankEntry.id !== 'string' || bankEntry.id.length === 0) {
          continue;
        }
        // `default_for_currency?: boolean | null` on the documented type:
        // only an explicit TRUE establishes a default payout destination.
        if (bankEntry.default_for_currency !== true) continue;
        bankEntries.push({
          id: bankEntry.id,
          status:
            typeof bankEntry.status === 'string' &&
            (bankEntry.status as string).length > 0
              ? (bankEntry.status as string)
              : null,
          currency:
            typeof bankEntry.currency === 'string' &&
            (bankEntry.currency as string).length > 0
              ? (bankEntry.currency as string).toLowerCase()
              : null,
        });
      }
    }

    const accountDefaultCurrency =
      typeof record.default_currency === 'string' &&
      record.default_currency.length > 0
        ? record.default_currency.toLowerCase()
        : null;
    // Exactly one default is unambiguous; several defaults (one per currency)
    // need the account's documented payout currency to pick the destination
    // Stripe actually pays out to.
    const destination =
      bankEntries.length === 1
        ? bankEntries[0]
        : accountDefaultCurrency !== null
          ? (bankEntries.find(
              (candidate) => candidate.currency === accountDefaultCurrency,
            ) ?? null)
          : null;
    if (destination) {
      externalAccountId = destination.id;
      externalAccountStatus = destination.status;
    }
  }

  return {
    kind,
    accountId,
    externalAccountId,
    payoutsEnabled,
    externalAccountStatus,
  };
}

export interface ApplyAccountActionabilityInput {
  eventId: string;
  eventType: string;
  accountId: string;
  occurredAt: string;
  /** Historical signed fields, never substituted with current retrievals. */
  externalAccountId: string | null;
  payoutsEnabled: boolean | null;
  externalAccountStatus: string | null;
  resolution: AccountActionabilityResolution;
}

export interface ConnectAccountCurrentSnapshot {
  accountId: string;
  generation: number;
  sourceEventId: string;
  actionable: boolean;
  blockedReason: string | null;
  payoutsEnabled: boolean | null;
  externalAccountId: string | null;
  externalAccountStatus: string | null;
  currency: string | null;
  defaultForCurrency: boolean | null;
  mxnDefaultCount: number | null;
}

export interface ConnectAccountActionabilityDeps {
  /** Idempotent append keyed by Stripe event identity; FALSE = duplicate. */
  recordAccountEvent: (input: ApplyAccountActionabilityInput) => Promise<boolean>;
  acquireAccountRefresh: (input: { accountId: string; sourceEventId: string }) => Promise<unknown>;
  retrieveCurrentAccount: (input: { accountId: string }) => Promise<unknown>;
  listCurrentBankAccounts: (input: { accountId: string; startingAfter?: string }) => Promise<unknown>;
  commitAccountRefresh: (input: ConnectAccountCurrentSnapshot) => Promise<boolean>;
}

function accountRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>) : null;
}

// Stripe 17 BankAccount.account documents string | Stripe.Account | null.
// Never infer ownership from the bank id or accept an arbitrary id-shaped object.
function normalizeStripeAccountId(value: unknown): string | null {
  const record = accountRecord(value);
  const id = typeof value === 'string' ? value
    : record?.object === 'account' && record.deleted !== true ? record.id : null;
  return typeof id === 'string' && /^acct_[A-Za-z0-9]+$/.test(id) ? id : null;
}

/** Reject lossy BIGINT serialization before any authoritative network read. */
export function parseAccountRefreshGeneration(value: unknown): number {
  const generation = typeof value === 'number' ? value
    : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new Error('ACCOUNT_REFRESH_INVALID_GENERATION');
  }
  return generation;
}

/**
 * Append immutable evidence, then acquire a separately committed generation
 * before network reads. Duplicate/undetermined evidence still refreshes. A2's
 * CAS is the only projection write; failure leaves acquisition pending. This
 * orders Selene snapshots, not Stripe mutations between read and acceptance.
 */
export async function applyConnectAccountActionability(
  input: ApplyAccountActionabilityInput,
  deps: ConnectAccountActionabilityDeps,
): Promise<ConnectAccountCurrentSnapshot> {
  const appended = await deps.recordAccountEvent(input);
  if (appended !== true && appended !== false) throw new Error('ACCOUNT_EVENT_APPEND_INVALID_RESULT');
  const generation = parseAccountRefreshGeneration(await deps.acquireAccountRefresh({
    accountId: input.accountId, sourceEventId: input.eventId,
  }));
  const account = accountRecord(await deps.retrieveCurrentAccount({ accountId: input.accountId }));
  if (normalizeStripeAccountId(account?.id) !== input.accountId || account?.deleted === true) {
    throw new Error('ACCOUNT_REFRESH_IDENTITY_MISMATCH');
  }
  const payoutsEnabled = typeof account?.payouts_enabled === 'boolean' ? account.payouts_enabled : null;
  const defaults: Array<{ id: string; status: string | null }> = [];
  const seenBankIds = new Set<string>();
  let destinationUndetermined = false;
  let startingAfter: string | undefined;
  for (;;) {
    const page = accountRecord(await deps.listCurrentBankAccounts({
      accountId: input.accountId, ...(startingAfter ? { startingAfter } : {}),
    }));
    if (!page || !Array.isArray(page.data) || page.data.length > 100 || typeof page.has_more !== 'boolean') {
      throw new Error('ACCOUNT_REFRESH_INVALID_BANK_PAGE');
    }
    if (page.has_more && page.data.length === 0) throw new Error('ACCOUNT_REFRESH_PAGINATION_NO_PROGRESS');
    let lastId: string | undefined;
    for (const item of page.data) {
      const bank = accountRecord(item);
      if (!bank || bank.object !== 'bank_account' || typeof bank.id !== 'string'
        || !/^ba_[A-Za-z0-9]+$/.test(bank.id) || bank.deleted === true) {
        throw new Error('ACCOUNT_REFRESH_INVALID_BANK_PAGE');
      }
      if (seenBankIds.has(bank.id)) throw new Error('ACCOUNT_REFRESH_PAGINATION_NO_PROGRESS');
      seenBankIds.add(bank.id);
      lastId = bank.id;
      if (normalizeStripeAccountId(bank.account) !== input.accountId) {
        throw new Error('ACCOUNT_REFRESH_IDENTITY_MISMATCH');
      }
      const currency = typeof bank.currency === 'string' ? bank.currency.toLowerCase() : null;
      if (!currency || !/^[a-z]{3}$/.test(currency)) {
        destinationUndetermined = true;
      } else if (currency === 'mxn') {
        if (typeof bank.default_for_currency !== 'boolean') destinationUndetermined = true;
        if (bank.default_for_currency === true) defaults.push({
          id: bank.id, status: typeof bank.status === 'string' && bank.status.length > 0 ? bank.status : null,
        });
      }
    }
    if (!page.has_more) break;
    // Validated final id is the exact starting_after cursor, never a chosen default.
    startingAfter = lastId;
  }
  const mxnDefaultCount = destinationUndetermined ? null : defaults.length;
  const destination = mxnDefaultCount === 1 ? defaults[0] : null;
  const status = destination?.status ?? null;
  // Same precedence and conservative healthy allowlist as the A2 SQL boundary.
  const blockedReason = payoutsEnabled === false ? 'payouts_disabled'
    : destination && status !== null && NON_ACTIONABLE_EXTERNAL_ACCOUNT_STATUSES.includes(status) ? status
    : payoutsEnabled === true && destination && status !== null && ['new', 'validated', 'verified'].includes(status)
      ? null : 'destination_undetermined';
  const snapshot: ConnectAccountCurrentSnapshot = {
    accountId: input.accountId, generation, sourceEventId: input.eventId,
    actionable: blockedReason === null, blockedReason, payoutsEnabled,
    externalAccountId: destination?.id ?? null, externalAccountStatus: status,
    currency: destination ? 'mxn' : null, defaultForCurrency: destination ? true : null, mxnDefaultCount,
  };
  const committed = await deps.commitAccountRefresh(snapshot);
  if (committed === false) throw new Error('ACCOUNT_REFRESH_SUPERSEDED');
  if (committed !== true) throw new Error('ACCOUNT_REFRESH_COMMIT_INVALID_RESULT');
  return snapshot;
}

async function resolveTerminalProjection(context: {
  runId: string;
  runStatus: TerminalRunStatus;
  paidAt: string | null;
  sellerId: string | null;
  targetStatus: TerminalRunStatus;
  input: ConnectPayoutReconciliationInput;
  deps: ConnectPayoutReconciliationDeps;
}): Promise<ConnectPayoutReconciliationResult> {
  const { runId, runStatus, paidAt, sellerId, targetStatus, input, deps } =
    context;

  if (targetStatus === runStatus) {
    if (targetStatus === 'paid') {
      // A freshly read paid run is not proof that all mappings and shipments
      // agree. The atomic RPC verifies same-payout paid equivalence under lock.
      await applyProjection({ runId, targetStatus, input, deps });
    }
    return { status: 'already_reconciled', runId };
  }

  if (targetStatus === 'paid') {
    // An older / out-of-order paid event must never re-release shipments or
    // regress a recorded failure: resolve against authoritative Stripe state.
    const authority = await consultAuthoritativePayout({
      payoutId: input.payoutId,
      sellerId,
      deps,
    });

    if (authority.status === runStatus) {
      return { status: 'already_reconciled', runId };
    }

    await deps.markRunReconciliationNeeded({
      runId,
      failureReason: `PAYOUT_AUTHORITY_CONFLICT: authoritative state ${authority.status} conflicts with recorded ${runStatus}`,
    });
    return { status: 'reconciliation_needed', runId };
  }

  if (runStatus !== 'paid') {
    // Same failure-family terminal state; no aggregate or release change.
    return { status: 'already_reconciled', runId };
  }

  // Observed paid → later failure: the documented late reversal applies the
  // downgrade directly from the signed event.
  const isLaterFailure = paidAt !== null && input.occurredAt >= paidAt;
  if (targetStatus === 'failed' && isLaterFailure) {
    await applyProjection({
      runId,
      targetStatus,
      input,
      deps,
    });
    return { status: 'reconciled', runId };
  }

  // Occurrence order is ambiguous, the failure event is older than the
  // observed paid state, or the event is a cancellation Stripe does not
  // document as reachable from paid: Stripe decides the true outcome.
  const authority = await consultAuthoritativePayout({
    payoutId: input.payoutId,
    sellerId,
    deps,
  });

  if (authority.status !== targetStatus) {
    return { status: 'already_reconciled', runId };
  }

  const confirmedInput: ConnectPayoutReconciliationInput = {
    ...input,
    failureBalanceTransaction:
      input.failureBalanceTransaction ??
      authority.failureBalanceTransaction ??
      null,
  };

  await applyProjection({
    runId,
    targetStatus,
    input: confirmedInput,
    deps,
  });
  return { status: 'reconciled', runId };
}

async function consultAuthoritativePayout(context: {
  payoutId: string;
  sellerId: string | null;
  deps: ConnectPayoutReconciliationDeps;
}): Promise<ConnectPayoutAuthorityState> {
  const { payoutId, sellerId, deps } = context;
  const stripeAccountId = await deps.getSellerStripeAccountId(sellerId);
  return deps.resolveAuthoritativePayout({
    payoutId,
    stripeAccountId,
  });
}

async function applyProjection(context: {
  runId: string;
  targetStatus: TerminalRunStatus;
  input: ConnectPayoutReconciliationInput;
  deps: ConnectPayoutReconciliationDeps;
}): Promise<void> {
  const { runId, targetStatus, input, deps } = context;

  // The atomic RPC is the ONLY outcome write: run projection, mapping
  // projection, and shipment payout-id set/clear are one conditional unit in
  // the same database transaction. Its FALSE result (a concurrent writer
  // consumed the run, the payout id does not match, or the outcome would
  // regress terminal authority) aborts everything — there are no dependent
  // mapping or shipment writes left for this handler to apply.
  const projected = await deps.markRunStatus({
    runId,
    payoutId: input.payoutId,
    status: targetStatus,
    occurredAt: input.occurredAt,
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    ...(input.failureBalanceTransaction
      ? { failureBalanceTransaction: input.failureBalanceTransaction }
      : {}),
  });
  if (!projected) {
    throw new Error('PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT');
  }
}
