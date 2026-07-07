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
              'id, seller_id, amount, status, stripe_payout_id, connect_payout_run_shipments(shipment_id)',
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
              status: 'pending_reconciliation',
            })
            .select('id')
            .single();
          if (error || !data) {
            throw new ConnectPayoutReleaseError('RUN_CREATE_FAILED', 500);
          }
          return { id: data.id };
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
        retrieveConnectedBalance: async (input) => {
          const balance = await stripe.balance.retrieve(
            {},
            { stripeAccount: input.stripeAccountId },
          );

          return {
            available: balance.available.map((entry) => ({
              amount: entry.amount,
              currency: entry.currency,
            })),
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
        markRunRetrying: async (input) => {
          const now = new Date().toISOString();
          const { error: runError } = await supabaseAdmin
            .from('connect_payout_runs')
            .update({
              status: 'pending_reconciliation',
              failure_reason: null,
              failed_at: null,
              updated_at: now,
            })
            .eq('id', input.runId);
          if (runError) {
            log('ERROR', 'Failed to mark Connect payout run retrying', {
              runId: input.runId,
              ...getSupabaseErrorLogMeta(runError),
            });
            throw new ConnectPayoutReleaseError('RUN_RETRY_MARK_FAILED', 500);
          }

          const { error: shipmentError } = await supabaseAdmin
            .from('connect_payout_run_shipments')
            .update({ status: 'pending_reconciliation', updated_at: now })
            .eq('run_id', input.runId);
          if (shipmentError) {
            log(
              'ERROR',
              'Failed to mark Connect payout run shipments retrying',
              {
                runId: input.runId,
                ...getSupabaseErrorLogMeta(shipmentError),
              },
            );
            throw new ConnectPayoutReleaseError(
              'RUN_SHIPMENTS_RETRY_MARK_FAILED',
              500,
            );
          }
        },
        markRunStripePayoutFailed: async (input) => {
          const now = new Date().toISOString();
          const { error: shipmentError } = await supabaseAdmin
            .from('connect_payout_run_shipments')
            .update({ status: 'failed', updated_at: now })
            .eq('run_id', input.runId);
          if (shipmentError) {
            log('ERROR', 'Failed to mark Connect payout run shipments failed', {
              runId: input.runId,
              failureReason: input.failureReason,
              ...getSupabaseErrorLogMeta(shipmentError),
            });
            throw new ConnectPayoutReleaseError(
              'RUN_SHIPMENTS_FAILURE_MARK_FAILED',
              500,
            );
          }

          const { error: runError } = await supabaseAdmin
            .from('connect_payout_runs')
            .update({
              status: 'failed',
              failure_reason: input.failureReason,
              failed_at: now,
              updated_at: now,
            })
            .eq('id', input.runId);
          if (runError) {
            log('ERROR', 'Failed to mark Connect payout run failed', {
              runId: input.runId,
              failureReason: input.failureReason,
              ...getSupabaseErrorLogMeta(runError),
            });
            throw new ConnectPayoutReleaseError('RUN_FAILURE_MARK_FAILED', 500);
          }
        },
        markRunStripePayoutAmbiguous: async (input) => {
          const now = new Date().toISOString();
          const { error: shipmentError } = await supabaseAdmin
            .from('connect_payout_run_shipments')
            .update({ status: 'reconciliation_needed', updated_at: now })
            .eq('run_id', input.runId);
          if (shipmentError) {
            log(
              'ERROR',
              'Failed to mark Connect payout run shipments for reconciliation',
              {
                runId: input.runId,
                failureReason: input.failureReason,
                ...getSupabaseErrorLogMeta(shipmentError),
              },
            );
            throw new ConnectPayoutReleaseError(
              'RUN_SHIPMENTS_RECONCILIATION_MARK_FAILED',
              500,
            );
          }

          const { error: runError } = await supabaseAdmin
            .from('connect_payout_runs')
            .update({
              status: 'reconciliation_needed',
              failure_reason: input.failureReason,
              failed_at: null,
              updated_at: now,
            })
            .eq('id', input.runId);
          if (runError) {
            log('ERROR', 'Failed to mark Connect payout run for reconciliation', {
              runId: input.runId,
              failureReason: input.failureReason,
              ...getSupabaseErrorLogMeta(runError),
            });
            throw new ConnectPayoutReleaseError(
              'RUN_RECONCILIATION_MARK_FAILED',
              500,
            );
          }
        },
        markRunPendingReconciliation: async (input) => {
          const now = new Date().toISOString();
          const { error } = await supabaseAdmin
            .from('connect_payout_runs')
            .update({
              stripe_payout_id: input.stripePayoutId ?? null,
              status: 'pending_reconciliation',
              failure_reason: null,
              failed_at: null,
              updated_at: now,
            })
            .eq('id', input.runId);
          if (error) {
            log('ERROR', 'Failed to store Stripe payout id on run', {
              runId: input.runId,
              stripePayoutId: input.stripePayoutId,
              ...getSupabaseErrorLogMeta(error),
            });
            throw new ConnectPayoutReleaseError('RUN_UPDATE_FAILED', 500);
          }

          const { error: shipmentError } = await supabaseAdmin
            .from('connect_payout_run_shipments')
            .update({ status: 'pending_reconciliation', updated_at: now })
            .eq('run_id', input.runId);
          if (shipmentError) {
            log('ERROR', 'Failed to mark run shipments pending', {
              runId: input.runId,
              stripePayoutId: input.stripePayoutId,
              ...getSupabaseErrorLogMeta(shipmentError),
            });
            throw new ConnectPayoutReleaseError(
              'RUN_SHIPMENTS_UPDATE_FAILED',
              500,
            );
          }
        },
        markRunPayoutSyncFailed: async (input) => {
          const { error } = await supabaseAdmin
            .from('connect_payout_runs')
            .update({
              stripe_payout_id: input.stripePayoutId,
              status: 'reconciliation_needed',
              failure_reason: input.failureReason,
              updated_at: new Date().toISOString(),
            })
            .eq('id', input.runId);
          if (error) {
            throw new ConnectPayoutReleaseError(
              'RUN_RECONCILIATION_MARK_FAILED',
              500,
            );
          }
        },
      },
    );

    if (!response.success && response.code === 'stripe_balance_insufficient') {
      log('WARN', 'Connect payout release blocked by insufficient Stripe balance', {
        ...getStripeBalanceInsufficientLogMeta({
          sellerId: request.sellerId,
          shipmentCount: request.shipmentIds.length,
          response,
        }),
      });
    } else {
      log('INFO', 'Connect payout release accepted', {
        runId: response.success ? response.runId : null,
        shipmentCount: request.shipmentIds.length,
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
