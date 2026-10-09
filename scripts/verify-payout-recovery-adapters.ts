/** Offline transport/production-adapter/orchestrator proof, NOT PostgreSQL or provider E2E. */
import assert from 'node:assert/strict';
import { createReconciliationAdapters } from '../supabase/functions/resume-pending-payouts/reconciliation-adapter.ts';
import type { ReconciliationMappingClient } from '../supabase/functions/resume-pending-payouts/reconciliation-adapter.ts';
import { resumePendingPayoutRuns } from '../supabase/functions/resume-pending-payouts/resume-pending-payouts.ts';
import type { ReconciliationClaim, ReconciliationMapping, ResumePendingPayoutsDeps } from '../supabase/functions/resume-pending-payouts/resume-pending-payouts.ts';
import { createAtomicResumeAdapters } from '../supabase/functions/release-connect-payout/atomic-resume-adapter.ts';
import { ConnectPayoutReleaseError, releaseConnectPayout } from '../supabase/functions/release-connect-payout/release-connect-payout.ts';
import type { AtomicResumeMappingArgs, ConnectPayoutReleaseDependencies, ExistingConnectPayoutRun, ReleaseQueueRow, ResumeMappingIntent } from '../supabase/functions/release-connect-payout/release-connect-payout.ts';

export interface AdapterVerificationCase {
  name: string;
  status: 'PASS' | 'FAIL';
  evidence: Record<string, unknown>;
}
type RpcCall = { name: string; args: Record<string, unknown>; errorCode?: string };
const claim: ReconciliationClaim = {
  run_id: 'OFFLINE-run', actor_id: 'OFFLINE-admin', seller_id: 'OFFLINE-seller',
  amount_cents: 100, idempotency_key: 'OFFLINE-key', claim_token: 'OFFLINE-token',
  stage_version: 7, claim_expires_at: '2099-01-01T00:05:00Z',
  stripe_account_id: 'OFFLINE-account', payout_create_attempted_at: '2099-01-01T00:00:00Z',
};
const mapping: ReconciliationMapping = {
  id: 'OFFLINE-mapping', run_id: claim.run_id, shipment_id: 'OFFLINE-shipment',
  net_payout: 100, status: 'pending_reconciliation',
};
const row: ReleaseQueueRow = {
  shipment_id: mapping.shipment_id, seller_id: claim.seller_id, order_id: 'OFFLINE-order',
  status: 'completed', completed_at: '2098-12-31T00:00:00Z',
  is_eligible: false, ineligible_reason: 'already_released', release_amount_cents: 100,
  stripe_account_id: claim.stripe_account_id, stripe_onboarding_status: 'complete',
  stripe_transfer_id: 'OFFLINE-persisted-transfer',
};
const expectedClaimArgs = { p_run_id: claim.run_id, p_claim_token: claim.claim_token, p_expected_stage_version: 7 };
const intent: ResumeMappingIntent = {
  runId: claim.run_id, expectedStatus: 'pending_reconciliation',
  expectedStage: 'awaiting_connected_balance', expectedVersion: 7,
  shipmentIds: [mapping.shipment_id], parent: null,
};
function expectedAtomicArgs(mode: 'retry' | 'pending', version = 7): AtomicResumeMappingArgs {
  return {
    p_run_id: claim.run_id, p_mode: mode, p_expected_status: 'pending_reconciliation',
    p_expected_stage: 'awaiting_connected_balance', p_expected_version: version,
    p_shipment_ids: [mapping.shipment_id], p_parent_run_id: null,
    p_expected_parent_version: null, p_expected_parent_payout_id: null,
  };
}

/** No environment/config/SDK construction. Every transport is an in-memory stub. */
export async function verifyPayoutRecoveryAdapters() {
  const cases: AdapterVerificationCase[] = [];
  const forbiddenCalls: string[] = [];
  let payoutCreateCalls = 0;
  let unexpectedNetworkAttempts = 0;
  const originalFetch = globalThis.fetch;
  const denyNetwork = async (): Promise<never> => { throw new Error('OFFLINE_NETWORK_FORBIDDEN'); };
  const guardedFetch = Object.assign(async () => {
    unexpectedNetworkAttempts += 1;
    return denyNetwork();
  }, { preconnect: () => { unexpectedNetworkAttempts += 1; throw new Error('OFFLINE_NETWORK_FORBIDDEN'); } });
  globalThis.fetch = guardedFetch as typeof fetch;
  const forbidden = (name: string) => async (): Promise<never> => {
    forbiddenCalls.push(name);
    if (name === 'payouts.create') payoutCreateCalls += 1;
    throw new Error(`OFFLINE_UNEXPECTED_OPERATION:${name}`);
  };
  const runCase = async (name: string, body: () => Promise<Record<string, unknown>>) => {
    try {
      const evidence = await body();
      assert.deepEqual(forbiddenCalls, [], 'No dependent cleanup, mapping writes, fence, attach or provider create');
      assert.equal(unexpectedNetworkAttempts, 0, 'No attempted network transport');
      cases.push({ name, status: 'PASS', evidence });
    } catch (error) {
      cases.push({ name, status: 'FAIL', evidence: { error: error instanceof Error ? error.message : String(error) } });
    }
  };
  try {
    const reconcile = async (rows: ReconciliationMapping[], count: number | null) => {
      const rpcCalls: RpcCall[] = [];
      const query: unknown[] = [];
      const listed: unknown[] = [];
      let offered = false;
      let releaseRowsLoaded = 0;
      let stage = 'payout_create_in_progress';
      const client: ReconciliationMappingClient = {
        from: (table) => {
          query.push(['from', table]);
          return { select: (columns, options) => {
            query.push(['select', columns, options]);
            return { eq: async (column, runId) => {
              query.push(['eq', column, runId]);
              return { data: rows, error: null, count };
            } };
          } };
        },
      };
      const adapters = createReconciliationAdapters(async (name, args, errorCode) => {
        rpcCalls.push({ name, args, errorCode });
        switch (name) {
          case 'fn_claim_awaiting_balance_payout_run': return [];
          case 'fn_claim_payout_create_reconciliation':
            if (offered) return [];
            offered = true;
            return [structuredClone(claim)];
          case 'fn_verify_payout_claim':
            assert.deepEqual(args, expectedClaimArgs);
            return true; // Transport model, NOT a live SQL ownership check.
          case 'fn_abort_payout_create_to_action_required':
            assert.deepEqual(args, { ...expectedClaimArgs, p_reason: 'PAYOUT_CREATE_RECONCILIATION_MATCHES:0' });
            stage = 'action_required';
            return true;
          case 'fn_release_payout_claim':
            assert.deepEqual(args, { p_run_id: claim.run_id, p_claim_token: claim.claim_token });
            return null;
          default: throw new Error(`UNEXPECTED_RPC:${name}`);
        }
      }, client);
      const deps: ResumePendingPayoutsDeps = {
        ...adapters,
        loadReleaseRows: async (ids) => {
          assert.deepEqual(ids, [mapping.shipment_id]);
          releaseRowsLoaded += 1;
          return [structuredClone(row)];
        },
        getActorProfile: forbidden('actor_lookup'), getAccountActionability: forbidden('actionability_lookup'),
        markRunBlockedByAccount: forbidden('block'), transitionRunToActionRequired: forbidden('transition'),
        deferAwaitingBalanceRun: forbidden('defer'), beginPayoutCreate: forbidden('fence_recreate'),
        completePayoutCreate: forbidden('payout_attach'), failPayoutCreate: forbidden('fail'),
        retrieveConnectedBalance: forbidden('balance'), createStripePayout: forbidden('payouts.create'),
        listStripePayoutsForReconciliation: async (input) => {
          listed.push(input);
          return []; // Offline payouts.list stub; no invented payout id.
        },
      };
      const summary = await resumePendingPayoutRuns(deps);
      assert.deepEqual(query, [
        ['from', 'connect_payout_run_shipments'],
        ['select', 'id, run_id, shipment_id, net_payout, status', { count: 'exact' }],
        ['eq', 'run_id', claim.run_id],
      ]);
      assert.deepEqual(rpcCalls[0], { name: 'fn_claim_awaiting_balance_payout_run', args: { p_lease_seconds: 300 }, errorCode: 'CLAIM_RPC_FAILED' });
      assert.deepEqual(rpcCalls[1], { name: 'fn_claim_payout_create_reconciliation', args: { p_grace_seconds: 600 }, errorCode: 'RECONCILE_CLAIM_RPC_FAILED' });
      assert.deepEqual(rpcCalls.at(-1), rpcCalls[1]);
      return { rpcCalls, query, listed, summary, stage, releaseRowsLoaded };
    };
    await runCase('faithful_dto_zero_match', async () => {
      assert.equal(Object.keys(claim).length, 10);
      assert.equal('shipment_ids' in claim, false);
      const result = await reconcile([mapping], 1);
      assert.equal(result.summary.actionRequired, 1);
      assert.equal(result.summary.errors, 0);
      assert.equal(result.stage, 'action_required');
      assert.equal(result.releaseRowsLoaded, 1);
      assert.deepEqual(result.listed, [{ stripeAccountId: claim.stripe_account_id, createdGte: claim.payout_create_attempted_at }]);
      assert.deepEqual(result.rpcCalls.map((call) => call.name), [
        'fn_claim_awaiting_balance_payout_run', 'fn_claim_payout_create_reconciliation',
        'fn_verify_payout_claim', 'fn_abort_payout_create_to_action_required',
        'fn_claim_payout_create_reconciliation',
      ]);
      return { dtoFields: 10, shipmentIdsInDto: false, ...result };
    });
    const invalidMappings: Array<[string, ReconciliationMapping[], number | null]> = [
      ['mapping_incomplete', [mapping], 2], ['mapping_empty', [], 0],
      ['mapping_duplicate', [mapping, { ...mapping, id: 'OFFLINE-other-mapping' }], 2],
      ['mapping_foreign', [{ ...mapping, run_id: 'OFFLINE-foreign-run' }], 1],
    ];
    for (const [name, rows, count] of invalidMappings) await runCase(name, async () => {
      const result = await reconcile(rows, count);
      assert.equal(result.summary.errors, 1);
      assert.equal(result.summary.results[0].error, 'RUN_SHAPE_INVALID');
      assert.equal(result.summary.actionRequired, 0);
      assert.equal(result.releaseRowsLoaded, 0);
      assert.deepEqual(result.listed, []);
      assert.equal(result.stage, 'payout_create_in_progress');
      assert.deepEqual(result.rpcCalls.map((call) => call.name), [
        'fn_claim_awaiting_balance_payout_run', 'fn_claim_payout_create_reconciliation',
        'fn_release_payout_claim', 'fn_claim_payout_create_reconciliation',
      ]);
      return result;
    });
    await runCase('awaiting_validator', async () => {
      const adapters = createReconciliationAdapters(async () => [claim], {
        from: () => { throw new Error('UNEXPECTED_MAPPING_QUERY'); },
      });
      await assert.rejects(adapters.claimAwaitingBalanceRun({ leaseSeconds: 300 }),
        { name: 'ResumePayoutsError', message: 'INVALID_CLAIMED_RUN', status: 500 });
      return { shipmentBearingBoundary: 'unchanged', missingShipmentIds: 'rejected' };
    });

    const release = async (drift: boolean) => {
      const state = {
        run: { id: claim.run_id, seller_id: claim.seller_id, shipment_ids: [mapping.shipment_id],
          amount: 100, status: 'pending_reconciliation', stripe_payout_id: null,
          release_stage: 'awaiting_connected_balance', release_stage_version: 7,
          payout_claim_token: null, payout_claim_expires_at: null } satisfies ExistingConnectPayoutRun,
        mappings: [structuredClone(mapping)], lastError: 'OFFLINE-preserved-audit',
      };
      const rpcCalls: Array<{ name: string; args: AtomicResumeMappingArgs }> = [];
      let beforeRefusal = structuredClone(state);
      let delayed = false;
      const adapters = createAtomicResumeAdapters(async (name, args) => {
        rpcCalls.push({ name, args: structuredClone(args) });
        assert.equal(name, 'fn_atomic_payout_resume_mapping');
        assert.deepEqual(args, expectedAtomicArgs(args.p_mode, args.p_mode === 'retry' ? 7 : 8));
        // Models server CAS only; does NOT execute SQL or claim transactional proof.
        if (args.p_expected_version !== state.run.release_stage_version) return { data: null, error: null };
        state.run.release_stage_version += 1;
        return { data: state.run.release_stage_version, error: null };
      });
      const deps: ConnectPayoutReleaseDependencies = {
        ...adapters,
        getActorProfile: async () => ({ role: 'admin' }),
        findRunByIdempotencyKey: async () => structuredClone(state.run),
        findActiveShipmentMappings: async () => [{ runId: claim.run_id, shipmentId: mapping.shipment_id, status: 'pending_reconciliation' }],
        loadReleaseRows: async () => [structuredClone(row)],
        getConnectAccountActionability: async () => {
          await Promise.resolve(); // Snapshot already captured by the actual release orchestrator.
          delayed = true;
          if (drift) state.run.release_stage_version += 1; // VERSION ONLY, same status and stage.
          beforeRefusal = structuredClone(state);
          return { isActionable: true, blockedReason: null };
        },
        loadReleaseOrders: async () => [{ id: row.order_id!, stripe_charge_id: 'OFFLINE-stored-charge', stripe_transfer_group: 'OFFLINE-stored-group' }],
        retrieveConnectedBalance: async () => ({ available: [{ amount: 0, currency: 'mxn' }] }),
        findRunById: forbidden('run_reread_after_refusal'), findRetryChildByParentRunId: forbidden('child_lookup'),
        createRun: forbidden('run_create'), createRunShipments: forbidden('mapping_write'),
        createStripeTransfer: forbidden('transfer_create'), markShipmentStripeTransferId: forbidden('transfer_write'),
        retrieveStripePayout: forbidden('payout_retrieve'), createStripePayout: forbidden('payouts.create'),
        markRunPayoutSyncFailed: forbidden('dependent_cleanup'), beginPayoutCreateFence: forbidden('manual_fence'),
        completePayoutCreateFence: forbidden('payout_attach'), failPayoutCreateFromFence: forbidden('failure_cleanup'),
        abortPayoutCreateToActionRequired: forbidden('abort_cleanup'),
      };
      const request = { actorId: claim.actor_id, sellerId: claim.seller_id, shipmentIds: [mapping.shipment_id], idempotencyKey: claim.idempotency_key };
      if (drift) {
        await assert.rejects(releaseConnectPayout(request, deps), (error: unknown) => {
          assert.ok(error instanceof ConnectPayoutReleaseError);
          assert.equal(error.message, 'PAYOUT_RESUME_MAPPING_CONFLICT');
          assert.equal(error.status, 409);
          return true;
        });
        assert.deepEqual(state, beforeRefusal, 'Full state unchanged after refusal');
        assert.deepEqual(rpcCalls.map((call) => call.args.p_mode), ['retry']);
        assert.equal(state.run.release_stage_version, 8);
      } else {
        assert.deepEqual(await releaseConnectPayout(request, deps), {
          success: true, runId: claim.run_id, status: 'pending_reconciliation', amount: 100,
        });
        assert.deepEqual(rpcCalls.map((call) => call.args.p_mode), ['retry', 'pending']);
        assert.equal(state.run.release_stage_version, 9);
      }
      assert.equal(delayed, true);
      assert.equal(state.run.status, 'pending_reconciliation');
      assert.equal(state.run.release_stage, 'awaiting_connected_balance');
      return { rpcCalls, state, originalSnapshotVersion: 7, delayedDependency: true, databaseExecution: false };
    };
    await runCase('atomic_version_only_drift', () => release(true));
    await runCase('atomic_supported_epoch', () => release(false));
    await runCase('atomic_response_refusals', async () => {
      const refused: unknown[] = [null, false, '8', 0, -1, 1.5, {}, Number.MAX_SAFE_INTEGER + 1];
      for (const data of refused) {
        const adapter = createAtomicResumeAdapters(async (name, args) => {
          assert.equal(name, 'fn_atomic_payout_resume_mapping');
          assert.deepEqual(args, expectedAtomicArgs(args.p_mode));
          return { data, error: null };
        });
        assert.equal(await adapter.markRunRetrying(intent), null);
        assert.equal(await adapter.markRunPendingReconciliation(intent), null);
      }
      return { refusedResponseKinds: ['null', 'false', 'string', 'zero', 'negative', 'fractional', 'object', 'unsafe_integer'], modes: ['retry', 'pending'] };
    });
    await runCase('atomic_rpc_errors', async () => {
      const adapter = createAtomicResumeAdapters(async () => ({ data: 8, error: { message: 'OFFLINE-transport-error' } }));
      await assert.rejects(adapter.markRunRetrying(intent), { name: 'ConnectPayoutReleaseError', message: 'RUN_RETRY_MARK_FAILED', status: 500 });
      await assert.rejects(adapter.markRunPendingReconciliation(intent), { name: 'ConnectPayoutReleaseError', message: 'RUN_UPDATE_FAILED', status: 500 });
      return { retry: 'RUN_RETRY_MARK_FAILED', pending: 'RUN_UPDATE_FAILED', httpStatus: 500 };
    });
    await runCase('network_guard', async () => {
      assert.notEqual(globalThis.fetch, originalFetch);
      // Exercise the exact deny function without making a global fetch request.
      await assert.rejects(denyNetwork(), { message: 'OFFLINE_NETWORK_FORBIDDEN' });
      return { fetchGuardInstalled: true, denialProbe: 'PASS', networkRequests: 0 };
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    scope: 'offline_adapter_orchestrator' as const,
    status: cases.every((entry) => entry.status === 'PASS') && unexpectedNetworkAttempts === 0 && forbiddenCalls.length === 0 ? 'PASS' as const : 'FAIL' as const,
    networkCalls: 0, unexpectedNetworkAttempts, payoutCreateCalls, forbiddenCalls, cases,
  };
}
if (import.meta.main) {
  const result = await verifyPayoutRecoveryAdapters();
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
