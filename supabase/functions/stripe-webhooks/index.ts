import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createClient,
  type SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import type {
  Database,
  Json,
} from '../../../packages/types/src/database.types.ts';
import { normalizeAccountStatus, type ConnectAccountLike } from '../_shared/connect-status.ts';
import { extractStripeChargeId } from '../_shared/stripe-charge.ts';
import { compensateRecoveryShell } from '../checkout-recovery-worker/recovery.ts';
import {
  applyConnectAccountActionability,
  extractSignedAccountEventData,
  parseAccountRefreshGeneration,
  reconcileConnectPayoutEvent,
  type ConnectAccountCurrentSnapshot,
  resolveAccountActionability,
  type ConnectPayoutAuthorityState,
  type ConnectPayoutEventEvidenceInput,
  type ConnectPayoutEventType,
  type StripePayoutStatus,
} from './connect-payout-reconciliation.ts';
import {
  SINGLE_MODAL_FLOW,
  buildSettlementOutcome,
  buildRecoveryShellInput,
  buildStripeFeeReconciliationPlan,
  resolvePaymentIntentSucceededAction,
  type RecoveryShellInput,
  type SingleModalSettlementInput,
} from './single-modal-settlement.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '\*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'stripe-webhook',
      level,
      msg,
      ...data,
    }),
  );
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2026-04-22.dahlia',
  httpClient: Stripe.createFetchHttpClient(),
});

const APP_NAME = 'selene';
const RECOVERABLE_MISSING_PAYOUT_ID_STATUSES = [
  'pending_reconciliation',
  'reconciliation_needed',
];

const CONNECT_PAYOUT_EVENT_TYPES = [
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
  'payout.canceled',
] as const;

// Phase 2B: signed account evidence events (previously excluded).
const CONNECT_ACCOUNT_EVENT_TYPES = [
  'account.updated',
  'account.external_account.created',
  'account.external_account.updated',
  'account.external_account.deleted',
] as const;

const normalizeStripePayoutStatus = (
  status: string | null | undefined,
): StripePayoutStatus | null => {
  switch (status) {
    case 'pending':
    case 'in_transit':
    case 'paid':
    case 'failed':
    case 'canceled':
      return status;
    default:
      return null;
  }
};

const normalizeFailureBalanceTransaction = (
  value: unknown,
): string | null => {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  ) {
    return (value as { id: string }).id;
  }
  return null;
};

type SupabaseAdminClient = SupabaseClient<Database>;

const isJson = (value: unknown): value is Json => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJson);
  }

  if (typeof value === 'object') {
    return Object.values(value).every(isJson);
  }

  return false;
};

const getWebhookEventType = (payload: Json): string => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const eventType = payload.type;
    if (typeof eventType === 'string') return eventType;
  }

  return 'unknown_parse_error';
};

const buildSingleModalAllocationPayload = (
  input: SingleModalSettlementInput,
) => ({
  buyer_id: input.buyerId,
  address_id: input.addressId,
  order_id: input.orderId,
  order_group_id: input.orderId,
  total_amount: input.totalsCents.buyerTotal / 100,
  rows: input.rows.map((row) => ({
    seller_id: row.sellerId,
    shipment_id: row.shipmentId,
    product_ids: row.productIds,
    gross_cents: row.grossCents,
    commission_cents: row.commissionCents,
    shipping_cents: row.shippingCents,
    seguro_cents: row.seguroCents,
    net_cents: row.netCents,
  })),
});

async function compensateSemanticCheckoutRecovery(
  supabaseAdmin: SupabaseAdminClient,
  intent: Stripe.PaymentIntent,
  chargeId: string,
  reason: string,
  recoveryShell: RecoveryShellInput,
) {
  const { data: shellData, error: shellError } = await supabaseAdmin.rpc(
    'fn_upsert_checkout_recovery_shell' as never,
    {
      p_stripe_payment_intent_id: intent.id,
      p_reason: reason,
      p_source_metadata: recoveryShell.sourceMetadata,
      p_charged_amount_cents: recoveryShell.chargedAmountCents,
      p_stripe_charge_id: chargeId,
    } as never,
  );
  if (shellError)
    throw new Error(`CHECKOUT_RECOVERY_SHELL_FAILED: ${shellError.message}`);
  const shellPayload: unknown = shellData;
  const recoveryRuntimeVersion =
    shellPayload &&
    typeof shellPayload === 'object' &&
    'runtime_version' in shellPayload &&
    typeof shellPayload.runtime_version === 'string'
      ? shellPayload.runtime_version
      : null;

  const charge = (await stripe.charges.retrieve(chargeId)) as Stripe.Charge & {
    transfer?: string | { id?: string } | null;
  };
  const hasDestinationTransfer = Boolean(charge.transfer);

  const result = await compensateRecoveryShell(
    { paymentIntentId: intent.id, hasDestinationTransfer },
    {
      claim: async () => {
        const { data, error } = await supabaseAdmin.rpc(
          'fn_claim_checkout_recovery_shells' as never,
          { p_limit: 1, p_stripe_payment_intent_id: intent.id } as never,
        );
        if (error)
          throw new Error(`CHECKOUT_RECOVERY_CLAIM_FAILED: ${error.message}`);
        const claims = (data ?? []) as Array<{
          stripe_payment_intent_id: string;
        }>;
        return claims.some(
          (claim) => claim.stripe_payment_intent_id === intent.id,
        )
          ? { kind: 'claimed' as const }
          : { kind: 'busy' as const };
      },
      createRefund: async (params) => {
        const refund = await stripe.refunds.create(
          {
            payment_intent: params.paymentIntentId,
            ...(params.reverseTransfer ? { reverse_transfer: true } : {}),
          },
          { idempotencyKey: params.idempotencyKey },
        );
        if (!refund.id || refund.status !== 'succeeded') {
          throw new Error(
            `STRIPE_REFUND_NOT_CONFIRMED:${refund.status ?? 'unknown'}`,
          );
        }
        return { id: refund.id };
      },
      finalize: async ({ refundId }) => {
        const { error } = await supabaseAdmin.rpc(
          'fn_finalize_checkout_recovery' as never,
          {
            p_stripe_payment_intent_id: intent.id,
            p_stripe_refund_id: refundId,
          } as never,
        );
        if (error)
          throw new Error(
            `CHECKOUT_RECOVERY_FINALIZE_FAILED: ${error.message}`,
          );
      },
      queueRetry: async ({ error: retryError }) => {
        const { error } = await supabaseAdmin.rpc(
          'fn_mark_checkout_recovery_retry' as never,
          {
            p_stripe_payment_intent_id: intent.id,
            p_error: retryError,
          } as never,
        );
        if (error)
          throw new Error(
            `CHECKOUT_RECOVERY_RETRY_QUEUE_FAILED: ${error.message}`,
          );
      },
    },
  );

  log('WARN', 'Checkout recovery compensation result', {
    intentId: intent.id,
    reason,
    result: result.kind,
    recoveryRuntimeVersion,
  });

  return { recoveryRuntimeVersion };
}

type ConnectPayoutRunRow = {
  id: string;
  status: string;
  stripe_payout_id: string | null;
  seller_id: string | null;
  paid_at: string | null;
};

async function findConnectPayoutRun(
  supabaseAdmin: SupabaseAdminClient,
  input: { payoutId: string; metadataRunId?: string | null },
): Promise<ConnectPayoutRunRow | null> {
  const { data: payoutRun, error: payoutRunError } = await supabaseAdmin
    .from('connect_payout_runs')
    .select('id, status, stripe_payout_id, seller_id, paid_at')
    .eq('stripe_payout_id', input.payoutId)
    .maybeSingle();
  if (payoutRunError)
    throw new Error(`PAYOUT_RUN_LOOKUP_FAILED: ${payoutRunError.message}`);
  if (payoutRun) return payoutRun as ConnectPayoutRunRow;

  if (input.metadataRunId) {
    const { data, error } = await supabaseAdmin
      .from('connect_payout_runs')
      .select('id, status, stripe_payout_id, seller_id, paid_at')
      .eq('id', input.metadataRunId)
      .maybeSingle();
    if (error) throw new Error(`PAYOUT_RUN_LOOKUP_FAILED: ${error.message}`);
    if (data) {
      const run = data as ConnectPayoutRunRow;
      if (
        run.stripe_payout_id ||
        RECOVERABLE_MISSING_PAYOUT_ID_STATUSES.includes(run.status)
      ) {
        return run;
      }
    }
  }

  return null;
}

async function attachConnectPayoutRunPayoutId(
  supabaseAdmin: SupabaseAdminClient,
  input: { runId: string; stripePayoutId: string; sellerId: string | null },
) {
  if (!input.sellerId) throw new Error('PAYOUT_RUN_ATTACH_CONFLICT');
  const { data, error } = await supabaseAdmin
    .from('connect_payout_runs')
    .update({
      stripe_payout_id: input.stripePayoutId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.runId)
    .eq('seller_id', input.sellerId)
    .is('stripe_payout_id', null)
    .in('status', RECOVERABLE_MISSING_PAYOUT_ID_STATUSES)
    .select('id');
  if (error) throw new Error(`PAYOUT_RUN_ATTACH_FAILED: ${error.message}`);
  if (((data as Array<{ id: string }> | null) ?? []).length !== 1) {
    const { data: current, error: lookupError } = await supabaseAdmin
      .from('connect_payout_runs')
      .select('id, seller_id, stripe_payout_id')
      .eq('id', input.runId)
      .maybeSingle();
    if (lookupError || !current || current.id !== input.runId ||
      current.seller_id !== input.sellerId ||
      !(current.stripe_payout_id === input.stripePayoutId)) {
      throw new Error('PAYOUT_RUN_ATTACH_CONFLICT');
    }
  }
}

async function markConnectPayoutRunStatus(
  supabaseAdmin: SupabaseAdminClient,
  input: {
    runId: string;
    payoutId: string;
    status: 'paid' | 'failed' | 'canceled';
    occurredAt: string;
    failureReason?: string | null;
    failureBalanceTransaction?: string | null;
  },
): Promise<boolean> {
  const failureReasonParts = [
    input.failureReason ?? input.status,
    ...(input.failureBalanceTransaction
      ? [
          `failure_balance_transaction: ${input.failureBalanceTransaction}`,
        ]
      : []),
  ];

  // Phase 2B final slice: the terminal projection is ONE atomic SECURITY
  // DEFINER RPC that conditionally projects the run, the shipment mappings
  // (monotonic filter), and the shipment payout-id set/clear in the same
  // transaction, so a webhook terminal event can never regress to pending
  // behind an in-flight worker and a paid handler that resumes after a failed
  // handler can never restore shipment payout ids behind a failed run.
  // A FALSE result means the run does not match the payout id, a concurrent
  // writer already consumed the run, or the outcome would regress terminal
  // authority: the raised conflict parks the run and NO dependent write
  // exists for the webhook to apply.
  const { data: projected, error } = await supabaseAdmin.rpc(
    'fn_project_payout_run_terminal' as never,
    {
      p_run_id: input.runId,
      p_payout_id: input.payoutId,
      p_target_status: input.status,
      p_occurred_at: input.occurredAt,
      p_failure_reason: failureReasonParts.join(' | '),
    } as never,
  );
  if (error) throw new Error(`PAYOUT_RUN_UPDATE_FAILED: ${error.message}`);
  if (projected !== true) {
    throw new Error('PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT');
  }
  return projected;
}

async function projectConnectPayoutRunStage(
  supabaseAdmin: SupabaseAdminClient,
  input: {
    runId: string;
    targetStage: 'payout_pending' | 'payout_in_transit';
    payoutId: string;
  },
): Promise<boolean> {
  // Phase 2B: the stage projection is monotonic inside the RPC — it refuses a
  // terminal run and never regresses payout_in_transit back to
  // payout_pending. TRUE covers both a fresh write and an idempotent no-op
  // (the run already sits at the target stage); FALSE is an observed refusal,
  // never treated as a successful projection.
  const { data: projected, error } = await supabaseAdmin.rpc(
    'fn_project_payout_run_stage' as never,
    {
      p_run_id: input.runId,
      p_payout_id: input.payoutId,
      p_target_stage: input.targetStage,
    } as never,
  );
  if (error) throw new Error(`PAYOUT_STAGE_UPDATE_FAILED: ${error.message}`);
  if (projected !== true) {
    throw new Error('PAYOUT_STAGE_PROJECTION_CONFLICT');
  }
  return true;
}

async function decideRejectedPayoutStagePark(
  supabaseAdmin: SupabaseAdminClient,
  input: { runId: string; payoutId: string; targetStage: 'payout_pending' | 'payout_in_transit'; failureReason: string; eventId: string },
): Promise<'superseded_paid' | 'superseded_failed' | 'parked' | 'identity_conflict'> {
  const { data, error } = await supabaseAdmin.rpc(
    'fn_decide_rejected_payout_stage_park' as never,
    {
      p_run_id: input.runId,
      p_payout_id: input.payoutId,
      p_target_stage: input.targetStage,
      p_failure_reason: input.failureReason,
    } as never,
  );
  if (error) throw new Error(`PAYOUT_STAGE_PARK_FAILED: ${error.message}`);
  if (data !== 'superseded_paid' && data !== 'superseded_failed' && data !== 'parked' && data !== 'identity_conflict') {
    throw new Error('PAYOUT_STAGE_PARK_INVALID_DECISION');
  }
  log('INFO', 'Payout stage conflict decision', { eventId: input.eventId, category: data });
  return data;
}

async function markConnectPayoutRunReconciliationNeeded(
  supabaseAdmin: SupabaseAdminClient,
  input: { runId: string; failureReason: string },
) {
  // Phase 2B slice 5: the reconciliation park is a guarded RPC, never a
  // direct UPDATE. It refuses nothing on the status side (a genuine conflict
  // or a failed dependent write legitimately parks a terminal run) but it is
  // still fenced: it bumps the monotonic stage version, moves the aggregate
  // to action_required, clears the executor claim and lease, and never
  // touches paid_at / failed_at terminal evidence.
  const { data: parked, error } = await supabaseAdmin.rpc(
    'fn_mark_payout_run_reconciliation_needed' as never,
    {
      p_run_id: input.runId,
      p_failure_reason: input.failureReason,
    } as never,
  );
  if (error) {
    throw new Error(`PAYOUT_RECONCILIATION_MARK_FAILED: ${error.message}`);
  }
  // FALSE is the idempotent no-op (already parked with the same recorded
  // reason): the run stays parked and the version stays monotonic.
  if (parked !== true) {
    log('INFO', 'Connect payout reconciliation park was a no-op', {
      runId: input.runId,
    });
  }
}

async function appendConnectPayoutEventEvidence(
  supabaseAdmin: SupabaseAdminClient,
  input: ConnectPayoutEventEvidenceInput,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    'fn_append_connect_payout_event' as never,
    {
      p_stripe_event_id: input.eventId,
      p_event_type: input.eventType,
      p_stripe_payout_id: input.payoutId,
      p_connect_payout_run_id: input.runId,
      p_stripe_created: input.stripeCreatedAt,
      p_observed_payout_status: input.observedStatus,
      p_failure_code: input.failureCode ?? null,
      p_failure_message: input.failureMessage ?? null,
      p_failure_balance_transaction: input.failureBalanceTransaction ?? null,
    } as never,
  );
  if (error) {
    throw new Error(`PAYOUT_EVENT_APPEND_FAILED: ${error.message}`);
  }
  if (data !== true && data !== false) {
    throw new Error('PAYOUT_EVENT_APPEND_INVALID_RESULT');
  }
  return data;
}

async function recordConnectAccountEvent(
  supabaseAdmin: SupabaseAdminClient,
  input: {
    eventId: string;
    accountId: string;
    eventType: string;
    occurredAt: string;
    externalAccountId: string | null;
    payoutsEnabled: boolean | null;
    externalAccountStatus: string | null;
  },
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    'fn_record_connect_account_event' as never,
    {
      p_stripe_event_id: input.eventId,
      p_stripe_account_id: input.accountId,
      p_event_type: input.eventType,
      p_stripe_created: input.occurredAt,
      p_external_account_id: input.externalAccountId,
      p_payouts_enabled: input.payoutsEnabled,
      p_external_account_status: input.externalAccountStatus,
    } as never,
  );
  if (error) throw new Error('ACCOUNT_EVENT_APPEND_FAILED');
  if (data !== true && data !== false) throw new Error('ACCOUNT_EVENT_APPEND_INVALID_RESULT');
  return data === true;
}

async function acquireConnectAccountRefreshRpc(
  supabaseAdmin: SupabaseAdminClient,
  input: { accountId: string; sourceEventId: string },
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc(
    'fn_acquire_connect_account_refresh' as never,
    { p_stripe_account_id: input.accountId, p_source_event_id: input.sourceEventId } as never,
  );
  if (error) throw new Error('ACCOUNT_REFRESH_ACQUIRE_FAILED');
  return parseAccountRefreshGeneration(data);
}

async function commitConnectAccountRefreshRpc(
  supabaseAdmin: SupabaseAdminClient,
  input: ConnectAccountCurrentSnapshot,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    'fn_commit_connect_account_refresh' as never,
    {
      p_stripe_account_id: input.accountId,
      p_expected_generation: input.generation,
      p_source_event_id: input.sourceEventId,
      p_is_actionable: input.actionable,
      p_blocked_reason: input.blockedReason,
      p_payouts_enabled: input.payoutsEnabled,
      p_current_external_account_id: input.externalAccountId,
      p_current_external_account_status: input.externalAccountStatus,
      p_current_currency: input.currency,
      p_current_default_for_currency: input.defaultForCurrency,
      p_mxn_default_count: input.mxnDefaultCount,
    } as never,
  );
  if (error) throw new Error('ACCOUNT_REFRESH_COMMIT_FAILED');
  if (data !== true && data !== false) throw new Error('ACCOUNT_REFRESH_COMMIT_INVALID_RESULT');
  return data === true;
}

async function getSellerConnectAccountId(
  supabaseAdmin: SupabaseAdminClient,
  sellerId: string | null,
): Promise<string | null> {
  if (!sellerId) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles_private')
    .select('stripe_account_id')
    .eq('id', sellerId)
    .maybeSingle();
  if (error) {
    throw new Error(`SELLER_ACCOUNT_LOOKUP_FAILED: ${error.message}`);
  }
  const row = data as { stripe_account_id: string | null } | null;
  return row?.stripe_account_id ?? null;
}

async function retrieveAuthoritativeConnectPayout(
  input: {
    payoutId: string;
    stripeAccountId: string | null;
  },
): Promise<ConnectPayoutAuthorityState> {
  if (!input.stripeAccountId) {
    throw new Error('CONNECT_ACCOUNT_LOOKUP_MISSING');
  }

  // Stripe Payout state is authoritative when evidence conflicts or arrives
  // out of order; the connected-account context is derived server-side.
  const payout = await stripe.payouts.retrieve(input.payoutId, {
    stripeAccount: input.stripeAccountId,
  });

  const status = normalizeStripePayoutStatus(payout.status);
  if (!status) {
    throw new Error(`UNEXPECTED_PAYOUT_STATUS:${String(payout.status)}`);
  }

  return {
    status,
    failureCode: payout.failure_code ?? null,
    failureMessage: payout.failure_message ?? null,
    failureBalanceTransaction: normalizeFailureBalanceTransaction(
      payout.failure_balance_transaction,
    ),
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('No signature', { status: 400 });

  let rawBody = '';

  try {
    rawBody = await req.text();
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        Deno.env.get('STRIPE_WEBHOOK_SECRET') || '',
      );
    } catch {
      // Fallback: Si falla, intentar descifrar con el secreto de Connect
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET') || '',
      );
    }

    const supabaseAdmin = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { type, dispute_id, app_name, buyer_id, product_ids, address_id } =
        intent.metadata;

      if (type === 'return_shipping') {
        log('INFO', 'Procesando pago de retorno', {
          dispute_id,
          intentId: intent.id,
        });
        const { error } = await supabaseAdmin.rpc('fn_log_return_payment', {
          p_dispute_id: dispute_id,
          p_stripe_id: intent.id,
          p_amount: intent.amount / 100,
        });
        if (error)
          throw new Error(`Fallo en fn_log_return_payment: ${error.message}`);
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      }

      const action = resolvePaymentIntentSucceededAction({
        metadata: intent.metadata as Record<string, string>,
        amount: intent.amount,
      });

      if (action.kind === 'single_modal') {
        const chargeId = extractStripeChargeId(intent);
        if (!chargeId) {
          throw new Error('MISSING_STRIPE_CHARGE_ID');
        }

        log('INFO', 'Procesando single-modal settlement', {
          intentId: intent.id,
          flow: SINGLE_MODAL_FLOW,
          transferGroup: action.payload.transferGroup,
          chargeId,
        });

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_create_shipments_from_single_payment',
          {
            p_stripe_payment_intent_id: intent.id,
            p_stripe_charge_id: chargeId,
            p_amount_received: intent.amount,
            p_transfer_group: action.payload.transferGroup,
            p_allocation: buildSingleModalAllocationPayload(action.payload),
          },
        );

        const outcome = buildSettlementOutcome({
          rpcResult: rpcData,
          rpcError,
        });

        if (outcome.kind === 'ok') {
          const { data: orderRow, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('actual_stripe_fee_cents, stripe_fee_reconciled_at')
            .eq('id', action.payload.orderId)
            .single();

          if (orderError || !orderRow) {
            throw new Error(
              `ORDER_STRIPE_FEE_LOOKUP_FAILED: ${orderError?.message || 'not_found'}`,
            );
          }

          const charge = (await stripe.charges.retrieve(chargeId, {
            expand: ['balance_transaction'],
          })) as Stripe.Charge;

          const feePlan = buildStripeFeeReconciliationPlan({
            existingActualStripeFeeCents:
              orderRow.actual_stripe_fee_cents ?? null,
            charge: charge as unknown as {
              id: string;
              balance_transaction?: string | { fee?: number | null } | null;
            },
            reconciledAt: new Date().toISOString(),
          });

          if (feePlan.kind === 'deferred') {
            const enqueuedAt = new Date().toISOString();
            const { error: enqueueError } = await supabaseAdmin
              .from('stripe_fee_reconciliation_jobs')
              .upsert(
                {
                  order_id: action.payload.orderId,
                  stripe_payment_intent_id: intent.id,
                  status: 'pending',
                  attempt_count: 0,
                  next_retry_at: enqueuedAt,
                  last_error: null,
                  updated_at: enqueuedAt,
                },
                {
                  onConflict: 'order_id,stripe_payment_intent_id',
                  ignoreDuplicates: true,
                },
              );

            if (enqueueError) {
              throw new Error(
                `STRIPE_FEE_RECONCILIATION_JOB_UPSERT_FAILED: ${enqueueError.message}`,
              );
            }
          }

          if (feePlan.kind === 'ready') {
            const { data: updatedRows, error: updateError } =
              await supabaseAdmin
                .from('orders')
                .update({
                  actual_stripe_fee_cents: feePlan.actualStripeFeeCents,
                  stripe_fee_reconciled_at: feePlan.stripeFeeReconciledAt,
                  updated_at: feePlan.stripeFeeReconciledAt,
                })
                .eq('id', action.payload.orderId)
                .is('actual_stripe_fee_cents', null)
                .select('id');

            if (updateError) {
              throw new Error(
                `ORDER_STRIPE_FEE_UPDATE_FAILED: ${updateError.message}`,
              );
            }

            if (
              ((updatedRows as Array<{ id: string }> | null) ?? []).length !== 1
            ) {
              const { data: refreshedOrder, error: refreshError } =
                await supabaseAdmin
                  .from('orders')
                  .select('actual_stripe_fee_cents')
                  .eq('id', action.payload.orderId)
                  .single();

              if (refreshError) {
                throw new Error(
                  `ORDER_STRIPE_FEE_REFRESH_FAILED: ${refreshError.message}`,
                );
              }

              if (refreshedOrder?.actual_stripe_fee_cents == null) {
                throw new Error('ORDER_STRIPE_FEE_UPDATE_CONFLICT');
              }
            }
          }

          return new Response(JSON.stringify(outcome.body), { status: 200 });
        }

        if (outcome.kind === 'recovered') {
          let recoveryRuntimeVersion: string | null = null;
          if (outcome.classification.refundRequired) {
            ({ recoveryRuntimeVersion } =
              await compensateSemanticCheckoutRecovery(
                supabaseAdmin,
                intent,
                chargeId,
                outcome.reason,
                buildRecoveryShellInput(intent),
              ));
          }
          log('WARN', 'Single-modal settlement recovered for ops retry', {
            intentId: intent.id,
            reason: outcome.reason,
            classification: outcome.classification.kind,
            runtimeSettlementVersion: outcome.runtimeVersion,
            recoveryRuntimeVersion,
          });
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
          });
        }

        if (outcome.kind === 'fatal_error') {
          log('ERROR', 'Single-modal settlement fatal_error', {
            intentId: intent.id,
            message: outcome.message,
          });
        }

        throw new Error(outcome.message);
      }

      if (action.kind === 'retired_grouped_settlement') {
        const chargeId = extractStripeChargeId(intent);
        if (!chargeId) throw new Error('MISSING_STRIPE_CHARGE_ID');
        const { recoveryRuntimeVersion } =
          await compensateSemanticCheckoutRecovery(
            supabaseAdmin,
            intent,
            chargeId,
            action.reason,
            action.recoveryShell,
          );
        log('WARN', 'Rejected retired seller-grouped settlement', {
          intentId: intent.id,
          reason: action.reason,
          classification: 'semantic',
          recoveryRuntimeVersion,
        });
        return new Response(
          JSON.stringify({
            received: true,
            retired: 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED',
          }),
          {
            status: 200,
          },
        );
      }

      if (action.kind === 'invalid_single_modal_metadata') {
        const chargeId = extractStripeChargeId(intent);
        if (!chargeId) throw new Error('MISSING_STRIPE_CHARGE_ID');
        const { recoveryRuntimeVersion } =
          await compensateSemanticCheckoutRecovery(
            supabaseAdmin,
            intent,
            chargeId,
            action.reason,
            action.recoveryShell,
          );
        log('WARN', 'Single-modal metadata requires checkout recovery', {
          intentId: intent.id,
          reason: action.reason,
          classification: 'semantic',
          recoveryRuntimeVersion,
        });
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      }

      // Legacy path: single PaymentIntent for entire order (pre-Connect)
      if (app_name === APP_NAME) {
        const productIdsArray = JSON.parse(product_ids || '[]');
        log('INFO', 'Procesando compra exitosa', {
          buyer_id,
          product_ids: productIdsArray,
        });

        const [{ data: settings }, { data: dbProducts }] = await Promise.all([
          supabaseAdmin.from('system_settings').select('*').single(),
          supabaseAdmin
            .from('products')
            .select('price')
            .in('id', productIdsArray),
        ]);

        if (
          !settings ||
          !dbProducts ||
          settings.service_fee_pct === null ||
          settings.service_fee_fixed_cents === null
        )
          throw new Error('Configuración o productos no encontrados');

        const realSubtotalCents = Math.round(
          dbProducts.reduce(
            (sum: number, p: { price: number }) => sum + Number(p.price),
            0,
          ) * 100,
        );
        const expectedServiceFeeCents =
          Math.round(realSubtotalCents * settings.service_fee_pct) +
          settings.service_fee_fixed_cents;
        const expectedTotalCents = realSubtotalCents + expectedServiceFeeCents;

        if (Math.abs(intent.amount - expectedTotalCents) > 1) {
          log('ERROR', 'FRAUDE DETECTADO: El monto no coincide', {
            intent: intent.amount,
            expected: expectedTotalCents,
          });
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: productIdsArray,
          });
          return new Response(JSON.stringify({ error: 'Fraud detected' }), {
            status: 200,
          });
        }

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_create_order_from_payment',
          {
            p_buyer_id: buyer_id,
            p_stripe_intent_id: intent.id,
            p_product_ids: productIdsArray,
            p_address_id: address_id,
            p_total_amount: intent.amount / 100,
            p_service_fee: expectedServiceFeeCents / 100,
          },
        );

        if (rpcError || (rpcData && !rpcData[0]?.success)) {
          const errorMsg = rpcError?.message || rpcData?.[0]?.error_message;
          log('ERROR', 'Fallo al completar orden en DB (Rollback iniciado)', {
            error: errorMsg,
          });
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: productIdsArray,
          });
          throw new Error(`Fallo DB: ${errorMsg}`);
        }

        log('INFO', 'Orden completada y stock descontado con éxito', {
          buyer_id,
        });
      }
    }

    if (
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.canceled'
    ) {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { product_ids, app_name, type } = intent.metadata;

      if (app_name === APP_NAME && type !== 'return_shipping' && product_ids) {
        log('INFO', 'Pago fallido/cancelado, liberando productos', {
          product_ids,
        });
        await supabaseAdmin.rpc('fn_release_products', {
          p_product_ids: JSON.parse(product_ids),
        });
      }
    }

    if (CONNECT_PAYOUT_EVENT_TYPES.includes(event.type as never)) {
      const eventType = event.type as ConnectPayoutEventType;
      const payout = event.data.object as Stripe.Payout;
      const observedStatus = normalizeStripePayoutStatus(payout.status);
      if (!observedStatus) {
        throw new Error(`UNEXPECTED_PAYOUT_STATUS:${String(payout.status)}`);
      }
      // Stripe event timestamps are the occurrence order; webhook arrival
      // order is not occurrence order.
      const occurredAt = new Date((event.created ?? 0) * 1000).toISOString();
      const result = await reconcileConnectPayoutEvent(
        {
          eventId: event.id,
          eventType,
          payoutId: payout.id,
          metadataRunId: payout.metadata?.run_id ?? null,
          occurredAt,
          observedStatus,
          failureReason: payout.failure_message ?? payout.failure_code ?? null,
          failureCode: payout.failure_code ?? null,
          failureMessage: payout.failure_message ?? null,
          failureBalanceTransaction: normalizeFailureBalanceTransaction(
            payout.failure_balance_transaction,
          ),
        },
        {
          findRunForPayout: (input) =>
            findConnectPayoutRun(supabaseAdmin, input),
          appendEventEvidence: (input) =>
            appendConnectPayoutEventEvidence(supabaseAdmin, input),
          markRunStatus: (input) =>
            markConnectPayoutRunStatus(supabaseAdmin, input),
          projectPayoutStage: (input) =>
            projectConnectPayoutRunStage(supabaseAdmin, {
              ...input,
              payoutId: payout.id,
            }),
          decideRejectedPayoutStagePark: (input) =>
            decideRejectedPayoutStagePark(supabaseAdmin, input),
          markRunReconciliationNeeded: (input) =>
            markConnectPayoutRunReconciliationNeeded(supabaseAdmin, input),
          attachRunPayoutId: (input) =>
            attachConnectPayoutRunPayoutId(supabaseAdmin, input),
          getSellerStripeAccountId: (sellerId) =>
            getSellerConnectAccountId(supabaseAdmin, sellerId),
          resolveAuthoritativePayout: (input) =>
            retrieveAuthoritativeConnectPayout(input),
        },
      );

      log('INFO', 'Connect payout reconciliation processed', {
        payoutId: payout.id,
        eventType: event.type,
        result: result.status,
        ...(result.status !== 'ignored' ? { runId: result.runId } : {}),
      });
    }

    if (CONNECT_ACCOUNT_EVENT_TYPES.includes(event.type as never)) {
      // Historical evidence stays separate from the authoritative snapshot.
      // Bind object/envelope identity before onboarding or actionability writes.
      const extraction = extractSignedAccountEventData({
        eventType: event.type,
        dataObject: event.data.object,
        // The signed envelope account is ONLY the identity fallback; it never
        // contributes actionability evidence.
        eventAccount: event.account ?? null,
      });
      const accountId = extraction?.accountId ?? null;
      if (!accountId || !extraction) {
        log('WARN', 'Account event identity refused', { eventId: event.id, eventType: event.type });
        throw new Error('ACCOUNT_EVENT_IDENTITY_INVALID');
      } else {
        const occurredAt = new Date((event.created ?? 0) * 1000).toISOString();

        if (event.type === 'account.updated') {
          const normalized = normalizeAccountStatus(
            event.data.object as ConnectAccountLike,
          );
          const refreshedAt = new Date().toISOString();

          log('INFO', 'account.updated received', {
            accountId,
            chargesEnabled: normalized.chargesEnabled,
            payoutsEnabled: normalized.payoutsEnabled,
            nextStatus: normalized.status,
          });

          const { error: updErr } = await supabaseAdmin
            .from('profiles_private')
            .update({
              stripe_onboarding_status: normalized.status,
              stripe_onboarding_refreshed_at: refreshedAt,
              updated_at: refreshedAt,
            })
            .eq('stripe_account_id', accountId);
          if (updErr) {
            log('ERROR', 'Failed to update onboarding status', {
              error: updErr.message,
            });
            throw new Error(`PROFILE_UPDATE_FAILED: ${updErr.message}`);
          }
        }

        try {
          const snapshot = await applyConnectAccountActionability(
            {
              eventId: event.id,
              eventType: event.type,
              accountId,
              occurredAt,
              externalAccountId: extraction.externalAccountId,
              payoutsEnabled: extraction.payoutsEnabled,
              externalAccountStatus: extraction.externalAccountStatus,
              resolution: resolveAccountActionability(extraction), // historical classification only
            },
            {
              recordAccountEvent: (input) => recordConnectAccountEvent(supabaseAdmin, input),
              acquireAccountRefresh: (input) => acquireConnectAccountRefreshRpc(supabaseAdmin, input),
              retrieveCurrentAccount: (input) => stripe.accounts.retrieve(input.accountId).catch(() => {
                throw new Error('ACCOUNT_REFRESH_RETRIEVAL_FAILED');
              }),
              listCurrentBankAccounts: (input) => stripe.accounts.listExternalAccounts(input.accountId, {
                object: 'bank_account', limit: 100,
                ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
              }).catch(() => { throw new Error('ACCOUNT_REFRESH_BANK_LIST_FAILED'); }),
              commitAccountRefresh: (input) => commitConnectAccountRefreshRpc(supabaseAdmin, input),
            },
          );
          log('INFO', 'Connect account refresh committed', {
            eventId: event.id, accountId, generation: snapshot.generation,
            actionable: snapshot.actionable, blockedReason: snapshot.blockedReason,
          });
        } catch (error) {
          // Bounded categories only: never log Stripe bank objects or raw SDK errors.
          const category = error instanceof Error && /^ACCOUNT_[A-Z_]+$/.test(error.message)
            ? error.message : 'ACCOUNT_REFRESH_FAILED';
          log('ERROR', 'Connect account refresh refused', { eventId: event.id, accountId, category });
          throw error; // Existing webhook retry/DLQ path; never successful refresh logging.
        }
      }
    }

    if (event.type === 'setup_intent.succeeded') {
      const si = event.data.object as Stripe.SetupIntent;
      const { user_id, app_name } = si.metadata || {};

      if (app_name === APP_NAME && user_id) {
        const pmId = si.payment_method as string;
        const pm = await stripe.paymentMethods.retrieve(pmId);

        await supabaseAdmin.from('payment_methods').insert({
          user_id,
          stripe_payment_method_id: pmId,
          brand: pm.card?.brand,
          last4: pm.card?.last4,
          exp_month: pm.card?.exp_month,
          exp_year: pm.card?.exp_year,
        });
        log('INFO', 'Nuevo método de pago guardado', { user_id });
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log('ERROR', 'Fallo crítico en Webhook', { error: message });

    try {
      const supabaseAdmin = createClient<Database>(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      let payload: Json = {};
      try {
        const parsed: unknown = JSON.parse(rawBody || '{}');
        if (isJson(parsed)) payload = parsed;
      } catch {
        // Silencioso por seguridad: si falla el parseo, cae en el fallback de objeto vacío.
      }

      await supabaseAdmin.from('webhook_dlq').insert({
        event_type: getWebhookEventType(payload),
        payload,
        error_message: message,
      });
      log('INFO', 'Evento fallido guardado en DLQ exitosamente');
    } catch (dlqErr: unknown) {
      log('CRITICAL', 'Fallo catastrófico: No se pudo guardar en DLQ', {
        error: String(dlqErr),
      });
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
});
