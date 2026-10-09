import { assertClaimedRun, assertReconciliationClaim } from './resume-pending-payouts.ts';
import type { ReconciliationMapping, ResumePendingPayoutsDeps } from './resume-pending-payouts.ts';

/** Transport boundary retains the entrypoint's RPC logging and error policy. */
export type ResumeRpcOrThrow = (
  name: string,
  args: Record<string, unknown>,
  errorCode: string,
) => Promise<unknown>;

export interface ReconciliationMappingClient {
  from(table: 'connect_payout_run_shipments'): {
    select(columns: 'id, run_id, shipment_id, net_payout, status', options: { count: 'exact' }): {
      eq(column: 'run_id', runId: string): PromiseLike<{
        data: ReconciliationMapping[] | null;
        error: unknown;
        count: number | null;
      }>;
    };
  };
}

type ReconciliationAdapters = Pick<ResumePendingPayoutsDeps,
  | 'claimAwaitingBalanceRun' | 'claimPayoutCreateReconciliation'
  | 'loadReconciliationMappings' | 'verifyPayoutClaim'
  | 'abortPayoutCreateToActionRequired' | 'releasePayoutClaim'>;

/** Shared by the deployed worker and the offline transport harness. */
export function createReconciliationAdapters(
  rpcOrThrow: ResumeRpcOrThrow,
  client: ReconciliationMappingClient,
): ReconciliationAdapters {
  return {
    claimAwaitingBalanceRun: async ({ leaseSeconds }) => {
      const rows = await rpcOrThrow('fn_claim_awaiting_balance_payout_run',
        { p_lease_seconds: leaseSeconds }, 'CLAIM_RPC_FAILED');
      const list = Array.isArray(rows) ? rows : [rows];
      return assertClaimedRun(list[0] ?? null);
    },
    claimPayoutCreateReconciliation: async ({ graceSeconds }) => {
      const rows = await rpcOrThrow('fn_claim_payout_create_reconciliation',
        { p_grace_seconds: graceSeconds }, 'RECONCILE_CLAIM_RPC_FAILED');
      const list = Array.isArray(rows) ? rows : [rows];
      return assertReconciliationClaim(list[0] ?? null);
    },
    loadReconciliationMappings: async (runId) => {
      const { data, error, count } = await client
        .from('connect_payout_run_shipments')
        .select('id, run_id, shipment_id, net_payout, status', { count: 'exact' })
        .eq('run_id', runId);
      if (error) throw new Error('RECONCILIATION_MAPPING_LOOKUP_FAILED');
      return { rows: data ?? [], total: count };
    },
    verifyPayoutClaim: async (input) => {
      const live = await rpcOrThrow('fn_verify_payout_claim', {
        p_run_id: input.runId,
        p_claim_token: input.claimToken,
        p_expected_stage_version: input.stageVersion,
      }, 'CLAIM_VERIFY_RPC_FAILED');
      return live === true;
    },
    abortPayoutCreateToActionRequired: async (input) => {
      const aborted = await rpcOrThrow('fn_abort_payout_create_to_action_required', {
        p_run_id: input.runId,
        p_claim_token: input.claimToken,
        p_expected_stage_version: input.stageVersion,
        p_reason: input.reason,
      }, 'PAYOUT_CREATE_ABORT_RPC_FAILED');
      return aborted === true;
    },
    releasePayoutClaim: async (input) => {
      await rpcOrThrow('fn_release_payout_claim', {
        p_run_id: input.runId, p_claim_token: input.claimToken,
      }, 'CLAIM_RELEASE_RPC_FAILED');
    },
  };
}
