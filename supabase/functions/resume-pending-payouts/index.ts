/**
 * @file supabase/functions/resume-pending-payouts/index.ts
 *
 * Server-only cron worker for the Phase 2B awaiting-balance payout executor.
 * Authenticated by the existing CRON_SECRET header, it claims token-fenced
 * awaiting-balance runs (pending_reconciliation, no Stripe payout id, every
 * shipment already transferred, actionable account, next attempt due),
 * revalidates the persisted original admin actor, and creates exactly one
 * payout behind a durable write-ahead fence using only DB-derived inputs
 * (persisted seller, shipments, amount, and idempotency key).
 *
 * Runs fenced in payout_create_in_progress by an earlier failed tick are
 * reconciled by server-side Stripe listing — never by a second create. Cron
 * scheduling is configured in the Supabase Dashboard (handoff only).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import {
  ResumePayoutsError,
  resumePendingPayoutRuns,
  validateResumeRequest,
} from './resume-pending-payouts.ts';
import { createReconciliationAdapters } from './reconciliation-adapter.ts';
import type { ReleaseQueueRow } from '../release-connect-payout/release-connect-payout.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

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

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'resume-pending-payouts',
      level,
      msg,
      ...meta,
    }),
  );
};

/** Bounded insufficient-balance backoff (seconds). */
const DEFER_BACKOFF_SECONDS = 300;

/** Upper bound for a single reconciliation listing page. */
const RECONCILE_LIST_LIMIT = 100;

const serveHandler = async (req: Request): Promise<Response> => {
  try {
    validateResumeRequest({
      method: req.method,
      suppliedCronSecret: req.headers.get('x-cron-secret'),
      expectedCronSecret: Deno.env.get('CRON_SECRET') ?? null,
    });

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!stripeSecret || !serviceRoleKey || !supabaseUrl) {
      throw new ResumePayoutsError(500, 'MISSING_SERVER_CONFIG');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    const rpcOrThrow = async (
      name: string,
      args: Record<string, unknown>,
      errorCode: string,
    ) => {
      const { data, error } = await supabaseAdmin.rpc(name, args);
      if (error) {
        log('ERROR', 'Awaiting-balance executor RPC failed', {
          rpc: name,
          ...getSupabaseErrorLogMeta(error),
        });
        // The SQL-side guard text (STALE_CLAIM, STAGE_VERSION_CONFLICT, ...)
        // is preserved so the worker can classify stale claims.
        throw new Error(`${error.code ?? ''} ${error.message}`.trim() || errorCode);
      }
      return data;
    };

    const summary = await resumePendingPayoutRuns({
      ...createReconciliationAdapters(rpcOrThrow, supabaseAdmin),
      getActorProfile: async (actorId) => {
        const { data, error } = await supabaseAdmin
          .from('profiles_private')
          .select('role')
          .eq('id', actorId)
          .maybeSingle();
        if (error) {
          log('ERROR', 'Actor profile lookup failed', {
            actorId,
            ...getSupabaseErrorLogMeta(error),
          });
          throw new Error('PROFILE_LOOKUP_FAILED');
        }
        return data ?? null;
      },
      getAccountActionability: async (sellerId) => {
        // Derive the seller's connected account from the DB, then consult the
        // derived actionability projection through its RPC: the table grants
        // are revoked from every role, so the worker must never direct-select
        // it. Unevidenced accounts default to actionable inside the RPC and
        // the SQL claim gate alike.
        const { data: profileRow, error: profileError } = await supabaseAdmin
          .from('profiles_private')
          .select('stripe_account_id')
          .eq('id', sellerId)
          .maybeSingle();
        if (profileError) {
          throw new Error('PROFILE_LOOKUP_FAILED');
        }
        const stripeAccountId = (
          profileRow as { stripe_account_id: string | null } | null
        )?.stripe_account_id;
        if (!stripeAccountId) {
          // No connected account: the release-shape revalidation will reject
          // the run before any Stripe call.
          return { isActionable: true, blockedReason: null };
        }
        const { data: actionability, error: actionabilityError } =
          await supabaseAdmin.rpc('fn_get_connect_account_actionability', {
            p_stripe_account_id: stripeAccountId,
          });
        if (actionabilityError) {
          log('ERROR', 'Account actionability lookup RPC failed', {
            ...getSupabaseErrorLogMeta(actionabilityError),
          });
          throw new Error('ACCOUNT_ACTIONABILITY_LOOKUP_FAILED');
        }
        const row = (
          Array.isArray(actionability) ? actionability[0] : actionability
        ) as
          | { is_actionable: boolean; blocked_reason: string | null }
          | null
          | undefined;
        return {
          isActionable: row?.is_actionable ?? true,
          blockedReason: row?.blocked_reason ?? null,
        };
      },

      markRunBlockedByAccount: async (input) => {
        // The park is a token-, version-, and lease-conditional RPC so a
        // stale worker can never park a newer claim; FALSE is reported to the
        // orchestration layer instead of being swallowed here.
        const blocked = await rpcOrThrow(
          'fn_block_payout_run_for_account_actionability',
          {
            p_run_id: input.runId,
            p_claim_token: input.claimToken,
            p_expected_stage_version: input.stageVersion,
            p_blocked_reason: input.blockedReason,
          },
          'ACCOUNT_BLOCK_RPC_FAILED',
        );
        return blocked === true;
      },
      transitionRunToActionRequired: async (input) => {
        // Durable drift (eligibility, dispute, or shape) parks the claimed
        // run through the guarded stage transition: token-, version-, and
        // lease-conditional, so a stale worker can never park a newer claim.
        const newVersion = await rpcOrThrow(
          'fn_transition_payout_release_stage',
          {
            p_run_id: input.runId,
            p_target_stage: 'action_required',
            p_expected_stage_version: input.stageVersion,
            p_claim_token: input.claimToken,
            p_last_error: input.reason,
          },
          'RUN_TRANSITION_RPC_FAILED',
        );
        return Number(newVersion) > 0;
      },
      loadReleaseRows: async (shipmentIds) => {
        const { data, error } = await supabaseAdmin
          .from('admin_connect_payout_release_view')
          .select('*')
          .in('shipment_id', shipmentIds);
        if (error) {
          log('ERROR', 'Release row lookup failed', {
            ...getSupabaseErrorLogMeta(error),
          });
          throw new Error('RELEASE_VIEW_FAILED');
        }
        return (data ?? []) as ReleaseQueueRow[];
      },
      deferAwaitingBalanceRun: async (input) => {
        const deferred = await supabaseAdmin.rpc(
          'fn_defer_awaiting_balance_run',
          {
            p_run_id: input.runId,
            p_claim_token: input.claimToken,
            p_expected_stage_version: input.stageVersion,
            p_backoff_seconds: DEFER_BACKOFF_SECONDS,
          },
        );
        if (deferred.error) {
          log('ERROR', 'Awaiting-balance defer RPC failed', {
            runId: input.runId,
            ...getSupabaseErrorLogMeta(deferred.error),
          });
          throw new Error('DEFER_RPC_FAILED');
        }
        return deferred.data === true;
      },
      beginPayoutCreate: async (input) => {
        const version = await rpcOrThrow(
          'fn_begin_payout_create_fence',
          {
            p_run_id: input.runId,
            p_claim_token: input.claimToken,
            p_expected_stage_version: input.stageVersion,
          },
          'PAYOUT_CREATE_FENCE_FAILED',
        );
        return Number(version);
      },
      completePayoutCreate: async (input) => {
        const completed = await rpcOrThrow(
          'fn_complete_payout_create_fence',
          {
            p_run_id: input.runId,
            p_claim_token: input.claimToken,
            p_expected_stage_version: input.stageVersion,
            p_stripe_payout_id: input.stripePayoutId,
          },
          'PAYOUT_CREATE_COMPLETE_RPC_FAILED',
        );
        return completed === true;
      },
      failPayoutCreate: async (input) => {
        const failed = await rpcOrThrow(
          'fn_fail_payout_create_from_fence',
          {
            p_run_id: input.runId,
            p_claim_token: input.claimToken,
            p_expected_stage_version: input.stageVersion,
            p_failure_reason: input.failureReason,
          },
          'PAYOUT_CREATE_FAIL_RPC_FAILED',
        );
        return failed === true;
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
      createStripePayout: async (input) => {
        const logMeta = {
          runId: input.metadata.run_id,
          shipmentCount: input.metadata.shipment_ids
            .split(',')
            .filter(Boolean).length,
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
      listStripePayoutsForReconciliation: async (input) => {
        // Bounded created window anchored on the durable create attempt, in
        // the connected-account context; metadata.run_id filtering happens on
        // the results so no undocumented listing parameter is assumed.
        const gte = Math.max(
          0,
          Math.floor(Date.parse(input.createdGte) / 1000) -
            5 * 60,
        );
        const payouts = await stripe.payouts.list(
          { created: { gte }, limit: RECONCILE_LIST_LIMIT },
          { stripeAccount: input.stripeAccountId },
        );
        return payouts.data.map((payout: Stripe.Payout) => ({
          id: payout.id,
          metadata: (payout.metadata ?? undefined) as
            | Record<string, unknown>
            | undefined,
        }));
      },
    });

    log('INFO', 'Awaiting-balance payout resume batch finished', {
      claimed: summary.claimed,
      resumed: summary.resumed,
      deferred: summary.deferred,
      skipped: summary.skipped,
      actionRequired: summary.actionRequired,
      errors: summary.errors,
      results: summary.results,
    });

    return new Response(JSON.stringify({ success: true, ...summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const status =
      error instanceof ResumePayoutsError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);

    log('ERROR', 'Awaiting-balance payout resume request failed', {
      message,
      status,
    });

    return new Response(JSON.stringify({ success: false, error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

serve(serveHandler);
