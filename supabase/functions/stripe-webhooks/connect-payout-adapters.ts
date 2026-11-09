import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type { Database } from '../../../packages/types/src/database.types.ts';
import type { ConnectPayoutEventEvidenceInput } from './connect-payout-reconciliation.ts';

export type SupabaseAdminClient = SupabaseClient<Database>;

export const RECOVERABLE_MISSING_PAYOUT_ID_STATUSES = [
  'pending_reconciliation',
  'reconciliation_needed',
];

export async function attachConnectPayoutRunPayoutId(
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
    if (
      lookupError ||
      !current ||
      current.id !== input.runId ||
      current.seller_id !== input.sellerId ||
      !(current.stripe_payout_id === input.stripePayoutId)
    ) {
      throw new Error('PAYOUT_RUN_ATTACH_CONFLICT');
    }
  }
}

export async function markConnectPayoutRunStatus(
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
      ? [`failure_balance_transaction: ${input.failureBalanceTransaction}`]
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

export async function appendConnectPayoutEventEvidence(
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
