/**
 * @file supabase/functions/release-connect-payout/index.ts
 *
 * Admin-only manual Stripe Connect payout release. The release amount is scoped
 * to selected completed shipments and persisted as a payout run before Stripe is
 * called, so retries can reuse the idempotent run instead of creating duplicate
 * payouts.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import {
  ConnectPayoutReleaseError,
  getConnectPayoutReleaseErrorStatus,
  getStripeBalanceInsufficientLogMeta,
  parseReleaseRequestBody,
  releaseConnectPayout,
  type ConnectPayoutRunStatus,
  type ReleaseQueueRow,
} from './release-connect-payout.ts';

import { createAtomicResumeAdapters } from './atomic-resume-adapter.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'release-connect-payout',
      level,
      msg,
      ...meta,
    }),
  );
};

const getStripeErrorLogMeta = (error: unknown): Record<string, unknown> => {
  if (!error || typeof error !== 'object') {
    return { stripeErrorType: typeof error };
  }

  const record = error as Record<string, unknown>;
  const raw =
    record.raw && typeof record.raw === 'object'
      ? (record.raw as Record<string, unknown>)
      : undefined;

  return {
    stripeErrorType: record.type,
    stripeErrorCode: record.code ?? raw?.code,
    stripeRequestId: record.requestId ?? raw?.requestId,
    stripeStatusCode: record.statusCode ?? raw?.statusCode,
  };
};

const getSupabaseErrorLogMeta = (
  error: { code?: string; message?: string; details?: string; hint?: string },
): Record<string, unknown> => ({
  supabaseErrorCode: error.code,
  supabaseErrorMessage: error.message,
  supabaseErrorDetails: error.details,
  supabaseErrorHint: error.hint,
});

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      throw new ConnectPayoutReleaseError('METHOD_NOT_ALLOWED', 405);
    }

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!stripeSecret || !serviceRoleKey || !supabaseUrl) {
      throw new ConnectPayoutReleaseError('MISSING_SERVER_CONFIG', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new ConnectPayoutReleaseError('AUTH_REQUIRED', 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = authHeader.slice('Bearer '.length);
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      throw new ConnectPayoutReleaseError('AUTH_REQUIRED', 401);
    }

    const request = parseReleaseRequestBody(await req.json().catch(() => ({})));
    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    const response = await releaseConnectPayout(
      { actorId: user.id, ...request },
      {
        ...createAtomicResumeAdapters((name, args) => supabaseAdmin.rpc(name, args)),
        getActorProfile: async (actorId) => {
          const { data, error } = await supabaseAdmin
            .from('profiles_private')
            .select('role')
            .eq('id', actorId)
            .maybeSingle();
          if (error) {
            throw new ConnectPayoutReleaseError('PROFILE_LOOKUP_FAILED', 500);
          }
          return data ?? null;
        },
        findRunByIdempotencyKey: async (idempotencyKey) => {
          const { data, error } = await supabaseAdmin
            .from('connect_payout_runs')
            .select(
              'id, seller_id, amount, status, stripe_payout_id, release_stage, release_stage_version, payout_claim_token, payout_claim_expires_at, connect_payout_run_shipments(shipment_id)',
            )
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();
          if (error) {
            throw new ConnectPayoutReleaseError('RUN_LOOKUP_FAILED', 500);
          }
          if (!data) return null;
          return {
            id: data.id,
            seller_id: data.seller_id,
            shipment_ids: (
              (
                data as typeof data & {
                  connect_payout_run_shipments?: Array<{
                    shipment_id: string | null;
                  }> | null;
                }
              ).connect_payout_run_shipments ?? []
            )
              .map((mapping) => mapping.shipment_id)
              .filter((shipmentId): shipmentId is string =>
                Boolean(shipmentId),
              ),
            amount: data.amount,
            status: data.status as ConnectPayoutRunStatus,
            stripe_payout_id: data.stripe_payout_id,
            release_stage: data.release_stage,
            release_stage_version: data.release_stage_version,
            payout_claim_token: data.payout_claim_token,
            payout_claim_expires_at: data.payout_claim_expires_at,
          };
        },
        findRunById: async (runId) => {
          const { data, error } = await supabaseAdmin
            .from('connect_payout_runs')
            .select(
              'id, seller_id, amount, status, stripe_payout_id, release_stage, release_stage_version, payout_claim_token, payout_claim_expires_at, connect_payout_run_shipments(shipment_id)',
            )
            .eq('id', runId)
            .maybeSingle();
          if (error) {
            throw new ConnectPayoutReleaseError('RUN_LOOKUP_FAILED', 500);
          }
          if (!data) return null;
          return {
            id: data.id,
            seller_id: data.seller_id,
            shipment_ids: (
              data.connect_payout_run_shipments ?? []
            )
              .map((mapping) => mapping.shipment_id)
              .filter((shipmentId): shipmentId is string =>
                Boolean(shipmentId),
              ),
            amount: data.amount,
            status: data.status as ConnectPayoutRunStatus,
            stripe_payout_id: data.stripe_payout_id,
            release_stage: data.release_stage,
            release_stage_version: data.release_stage_version,
            payout_claim_token: data.payout_claim_token,
            payout_claim_expires_at: data.payout_claim_expires_at,
          };
        },
        findRetryChildByParentRunId: async (parentRunId) => {
          const { data, error } = await supabaseAdmin
            .from('connect_payout_runs')
            .select(
              'id, seller_id, amount, status, stripe_payout_id, release_stage, release_stage_version, payout_claim_token, payout_claim_expires_at, connect_payout_run_shipments(shipment_id)',
            )
            .eq('retry_of_run_id', parentRunId)
            .maybeSingle();
          if (error) {
            throw new ConnectPayoutReleaseError(
              'RETRY_CHILD_LOOKUP_FAILED',
              500,
            );
          }
          if (!data) return null;
          return {
            id: data.id,
            seller_id: data.seller_id,
            shipment_ids: (
              data.connect_payout_run_shipments ?? []
            )
              .map((mapping) => mapping.shipment_id)
              .filter((shipmentId): shipmentId is string =>
                Boolean(shipmentId),
              ),
            amount: data.amount,
            status: data.status as ConnectPayoutRunStatus,
            stripe_payout_id: data.stripe_payout_id,
            release_stage: data.release_stage,
            release_stage_version: data.release_stage_version,
            payout_claim_token: data.payout_claim_token,
            payout_claim_expires_at: data.payout_claim_expires_at,
          };
        },
        findActiveShipmentMappings: async (shipmentIds) => {
          const { data, error } = await supabaseAdmin
            .from('connect_payout_run_shipments')
            .select('run_id, shipment_id, status')
            .in('shipment_id', shipmentIds)
            .in('status', [
              'pending_reconciliation',
              'paid',
              'reconciliation_needed',
            ]);
          if (error) {
            throw new ConnectPayoutReleaseError(
              'ACTIVE_RELEASE_LOOKUP_FAILED',
              500,
            );
          }
          return (data ?? []).map((mapping) => ({
            shipmentId: mapping.shipment_id,
            runId: mapping.run_id,
            status: mapping.status as
              | 'pending_reconciliation'
              | 'paid'
              | 'reconciliation_needed',
          }));
        },
        loadReleaseRows: async (shipmentIds) => {
          const { data, error } = await supabaseAdmin
            .from('admin_connect_payout_release_view')
            .select('*')
            .in('shipment_id', shipmentIds);
          if (error) {
            throw new ConnectPayoutReleaseError('RELEASE_VIEW_FAILED', 500);
          }
          return (data ?? []) as ReleaseQueueRow[];
        },
        loadReleaseOrders: async (orderIds) => {
          const { data, error } = await supabaseAdmin
            .from('orders')
            .select('id, stripe_charge_id, stripe_transfer_group')
            .in('id', orderIds);
          if (error) {
            throw new ConnectPayoutReleaseError('ORDER_LOOKUP_FAILED', 500);
          }
          return (data ?? []) as Array<{
            id: string;
            stripe_charge_id: string | null;
            stripe_transfer_group: string | null;
          }>;
        },
        createRun: async (input) => {
          const { data, error } = await supabaseAdmin
            .from('connect_payout_runs')
            .insert({
              actor_id: input.actorId,
              seller_id: input.sellerId,
              amount: input.amount,
              idempotency_key: input.idempotencyKey,
              retry_of_run_id: input.retryOfRunId ?? null,
              status: 'pending_reconciliation',
              // Phase 2B: the admin acceptance is the release_accepted stage.
              release_stage: 'release_accepted',
            })
            .select('id, status, release_stage, release_stage_version')
            .single();
          if (error || !data) {
            throw new ConnectPayoutReleaseError('RUN_CREATE_FAILED', 500);
          }
          return { id: data.id, status: data.status as ConnectPayoutRunStatus, release_stage: data.release_stage, release_stage_version: data.release_stage_version };
        },
        createRunShipments: async (input) => {
          const { error } = await supabaseAdmin
            .from('connect_payout_run_shipments')
            .insert(
              input.shipments.map((shipment) => ({
                run_id: input.runId,
                shipment_id: shipment.shipmentId,
                net_payout: shipment.netPayout,
                status: 'pending_reconciliation',
              })),
            );
          if (error) {
            throw new ConnectPayoutReleaseError(
              'RUN_SHIPMENTS_CREATE_FAILED',
              500,
            );
          }
        },
        createStripeTransfer: async (input) => {
          try {
            const transfer = await stripe.transfers.create(
              {
                amount: input.amount,
                currency: input.currency,
                destination: input.stripeAccountId,
                source_transaction: input.sourceTransaction,
                transfer_group: input.transferGroup,
                metadata: input.metadata,
              },
              {
                idempotencyKey: input.idempotencyKey,
              },
            );

            return { id: transfer.id };
          } catch (error) {
            log('ERROR', 'Stripe transfer creation failed', {
              stripeAccountId: input.stripeAccountId,
              amount: input.amount,
              sourceTransaction: input.sourceTransaction,
              transferGroup: input.transferGroup,
              ...getStripeErrorLogMeta(error),
            });
            throw error;
          }
        },
        markShipmentStripeTransferId: async (input) => {
          const { error } = await supabaseAdmin
            .from('shipments')
            .update({ stripe_transfer_id: input.stripeTransferId })
            .eq('id', input.shipmentId);
          if (error) {
            throw new ConnectPayoutReleaseError(
              'SHIPMENT_TRANSFER_UPDATE_FAILED',
              500,
            );
          }
        },
        retrieveStripePayout: async (input) => {
          const payout = await stripe.payouts.retrieve(
            input.payoutId,
            { stripeAccount: input.stripeAccountId },
          );
          return {
            id: payout.id,
            status: payout.status,
            failure_balance_transaction: payout.failure_balance_transaction,
            amount: payout.amount,
            currency: payout.currency,
          };
        },
        retrieveConnectedBalance: async (input) => {
          const balance = await stripe.balance.retrieve(
            {},
            { stripeAccount: input.stripeAccountId },
          );

          return {
            available: balance.available.map((entry: Stripe.Balance.Available) => ({
              amount: entry.amount,
              currency: entry.currency,
            })),
          };
        },
        getConnectAccountActionability: async (input) => {
          // Phase 2B: actionability is read only through the service-role
          // RPC; the projection tables are revoked from every role and are
          // never direct-selected by this endpoint.
          const { data, error } = await supabaseAdmin.rpc(
            'fn_get_connect_account_actionability',
            {
              p_stripe_account_id: input.stripeAccountId,
            },
          );
          if (error) {
            log('ERROR', 'Connect account actionability RPC failed', {
              stripeAccountId: input.stripeAccountId,
              ...getSupabaseErrorLogMeta(error),
            });
            throw new ConnectPayoutReleaseError(
              'ACCOUNT_ACTIONABILITY_LOOKUP_FAILED',
              500,
            );
          }
          const row = Array.isArray(data) ? data[0] : data;
          return {
            isActionable: row?.is_actionable ?? true,
            blockedReason: row?.blocked_reason ?? null,
          };
        },
        createStripePayout: async (input) => {
          const logMeta = {
            runId: input.metadata.run_id,
            shipmentCount: input.metadata.shipment_ids
              .split(',')
              .filter(Boolean).length,
            orderCount: input.orderIds.length,
          };

          log('INFO', 'Creating Stripe Connect payout', logMeta);

          try {
            const payout = await stripe.payouts.create(
              {
                amount: input.amount,
                currency: input.currency,
                metadata: input.metadata,
              },
              {
                stripeAccount: input.stripeAccountId,
                idempotencyKey: input.idempotencyKey,
              },
            );

            log('INFO', 'Stripe Connect payout created', {
              ...logMeta,
              stripePayoutId: payout.id,
              stripeRequestId: payout.lastResponse?.requestId,
            });

            return payout;
          } catch (error) {
            log('ERROR', 'Stripe Connect payout creation failed', {
              ...logMeta,
              ...getStripeErrorLogMeta(error),
            });
            throw error;
          }
        },

        beginPayoutCreateFence: async (input) => {
          // Phase 2B: the durable write-ahead fence is opened BEFORE the
          // Stripe payouts.create call; the manual path owns the run through
          // the version-conditioned fence stage (no executor claim token).
          const version = await supabaseAdmin.rpc(
            'fn_begin_manual_payout_create_fence',
            { p_run_id: input.runId },
          );
          if (version.error) {
            log('ERROR', 'Manual payout create fence RPC failed', {
              runId: input.runId,
              ...getSupabaseErrorLogMeta(version.error),
            });
            throw new Error(
              `${version.error.code ?? ''} ${version.error.message}`.trim(),
            );
          }
          return Number(version.data);
        },
        completePayoutCreateFence: async (input) => {
          const completed = await supabaseAdmin.rpc(
            'fn_complete_payout_create_fence',
            {
              p_run_id: input.runId,
              p_claim_token: null,
              p_expected_stage_version: input.stageVersion,
              p_stripe_payout_id: input.stripePayoutId,
            },
          );
          if (completed.error) {
            log('ERROR', 'Manual payout create fence completion RPC failed', {
              runId: input.runId,
              ...getSupabaseErrorLogMeta(completed.error),
            });
            throw new Error(
              `${completed.error.code ?? ''} ${completed.error.message}`.trim(),
            );
          }
          return completed.data === true;
        },
        failPayoutCreateFromFence: async (input) => {
          const failed = await supabaseAdmin.rpc(
            'fn_fail_payout_create_from_fence',
            {
              p_run_id: input.runId,
              p_claim_token: null,
              p_expected_stage_version: input.stageVersion,
              p_failure_reason: input.failureReason,
            },
          );
          if (failed.error) {
            log('ERROR', 'Manual payout create fence failure RPC failed', {
              runId: input.runId,
              ...getSupabaseErrorLogMeta(failed.error),
            });
            throw new Error(
              `${failed.error.code ?? ''} ${failed.error.message}`.trim(),
            );
          }
          return failed.data === true;
        },
        abortPayoutCreateToActionRequired: async (input) => {
          const aborted = await supabaseAdmin.rpc(
            'fn_abort_payout_create_to_action_required',
            {
              p_run_id: input.runId,
              p_claim_token: null,
              p_expected_stage_version: input.stageVersion,
              p_reason: input.reason,
            },
          );
          if (aborted.error) {
            log('ERROR', 'Manual payout create fence abort RPC failed', {
              runId: input.runId,
              ...getSupabaseErrorLogMeta(aborted.error),
            });
            throw new Error(
              `${aborted.error.code ?? ''} ${aborted.error.message}`.trim(),
            );
          }
          return aborted.data === true;
        },
        markRunPayoutSyncFailed: async (input) => {
          // Phase 2B final slice: the post-Stripe sync fallback is a guarded
          // RPC, never a direct UPDATE by run id. fn_mark_payout_run_sync_failed
          // refuses a terminal status (paid/failed/canceled) so webhook
          // terminal authority is never regressed, keeps the durable
          // payout_create_in_progress fence so the executor reconciliation
          // claim (never a second create) recovers the run, and is an
          // idempotent no-op for an already-parked run with the same recorded
          // reason. FALSE = refused (terminal/newer state preserved): the
          // caller performs no further write.
          const { data: parked, error } = await supabaseAdmin.rpc(
            'fn_mark_payout_run_sync_failed',
            {
              p_run_id: input.runId,
              p_stripe_payout_id: input.stripePayoutId,
              p_failure_reason: input.failureReason,
            },
          );
          if (error) {
            log('ERROR', 'Post-Stripe payout sync fallback RPC failed', {
              runId: input.runId,
              stripePayoutId: input.stripePayoutId,
              ...getSupabaseErrorLogMeta(error),
            });
            throw new ConnectPayoutReleaseError(
              'RUN_RECONCILIATION_MARK_FAILED',
              500,
            );
          }
          return parked === true;
        },

      },
    );

    const requestLogMeta =
      'retryRunId' in request
        ? { retryRunId: request.retryRunId }
        : {
            sellerId: request.sellerId,
            shipmentCount: request.shipmentIds.length,
          };

    if (!response.success && response.code === 'stripe_balance_insufficient') {
      log('WARN', 'Connect payout release blocked by insufficient Stripe balance', {
        ...requestLogMeta,
        ...('retryRunId' in request
          ? {
              code: response.code,
              required_amount_cents: response.required_amount_cents,
              available_amount_cents: response.available_amount_cents,
              currency: response.currency,
              retryable: response.retryable,
            }
          : getStripeBalanceInsufficientLogMeta({
              sellerId: request.sellerId,
              shipmentCount: request.shipmentIds.length,
              response,
            })),
      });
    } else {
      log('INFO', 'Connect payout release accepted', {
        ...requestLogMeta,
        runId: response.success ? response.runId : null,
      });
    }
    return jsonResponse(response, 200);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof ConnectPayoutReleaseError
        ? error.status
        : getConnectPayoutReleaseErrorStatus(message);

    log('ERROR', 'Connect payout release failed', { message, status });
    return jsonResponse({ success: false, error: message }, status);
  }
});
