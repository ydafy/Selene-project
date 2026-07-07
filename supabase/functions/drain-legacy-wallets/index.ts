import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

import {
  createDrainIdempotencyKey,
  selectDrainCandidates,
  summarizeDrainResults,
  type DrainResult,
} from './drain-legacy-wallets.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RequestSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

type PrivateProfileDrainRow = {
  id: string;
  stripe_account_id: string | null;
  stripe_onboarding_status: 'pending' | 'complete' | 'rejected' | null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!stripeSecret || !serviceRoleKey || !supabaseUrl) {
      throw new Error('MISSING_SERVER_CONFIG');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('AUTH_REQUIRED');

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    const { data: profile } = await supabaseAdmin
      .from('profiles_private')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');

    const { dryRun } = RequestSchema.parse(await req.json().catch(() => ({})));

    const { data: settings } = await supabaseAdmin
      .from('system_settings')
      .select('connect_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (!settings?.connect_enabled) throw new Error('CONNECT_NOT_ENABLED');

    const { data: wallets, error: walletsError } = await supabaseAdmin
      .from('wallets')
      .select('id, user_id, available_balance')
      .gte('available_balance', 0);
    if (walletsError) throw walletsError;

    const sellerIds = (wallets ?? []).map((wallet) => wallet.user_id);
    if (sellerIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          dryRun,
          transferredCount: 0,
          transferredCents: 0,
          failedCount: 0,
          skippedCount: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const { data: profileRows, error: profilesError } = await supabaseAdmin
      .from('profiles_private')
      .select('id, stripe_account_id, stripe_onboarding_status')
      .in('id', sellerIds);
    if (profilesError) throw profilesError;

    const profiles = (profileRows ?? []) as PrivateProfileDrainRow[];
    const profilesById = new Map((profiles ?? []).map((row) => [row.id, row]));
    const drainRows = (wallets ?? []).map((wallet) => {
      const seller = profilesById.get(wallet.user_id);
      return {
        walletId: wallet.id,
        userId: wallet.user_id,
        availableBalance: wallet.available_balance,
        stripeAccountId: seller?.stripe_account_id ?? null,
        onboardingStatus: seller?.stripe_onboarding_status ?? null,
      };
    });

    const results: DrainResult[] = [];
    for (const row of drainRows) {
      if (row.availableBalance <= 0) {
        await supabaseAdmin.from('admin_audit_logs').insert({
          action_type: 'legacy_wallet_drain_skipped_zero_balance',
          admin_id: user.id,
          target_id: row.userId,
          details: { wallet_id: row.walletId },
        });
        results.push({ status: 'skipped', amountCents: 0 });
      } else if (!row.stripeAccountId || row.onboardingStatus !== 'complete') {
        await supabaseAdmin.from('admin_audit_logs').insert({
          action_type: 'legacy_wallet_drain_skipped_not_onboarded',
          admin_id: user.id,
          target_id: row.userId,
          details: {
            wallet_id: row.walletId,
            amount_cents: Math.round(row.availableBalance * 100),
            onboarding_status: row.onboardingStatus,
          },
        });
        results.push({
          status: 'skipped',
          amountCents: Math.round(row.availableBalance * 100),
        });
      }
    }

    const candidates = selectDrainCandidates(drainRows);

    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    for (const candidate of candidates) {
      if (dryRun) {
        results.push({ status: 'skipped', amountCents: candidate.amountCents });
        continue;
      }

      try {
        const transfer = await stripe.transfers.create(
          {
            amount: candidate.amountCents,
            currency: 'mxn',
            destination: candidate.stripeAccountId,
            metadata: {
              flow: 'legacy_wallet_drain',
              seller_id: candidate.userId,
              wallet_id: candidate.walletId,
            },
          },
          {
            idempotencyKey: createDrainIdempotencyKey(
              candidate.walletId,
              candidate.amountCents,
            ),
          },
        );

        const { error: zeroError } = await supabaseAdmin
          .from('wallets')
          .update({
            available_balance: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', candidate.walletId)
          .eq('available_balance', candidate.availableBalance);
        if (zeroError) throw zeroError;

        await supabaseAdmin.from('admin_audit_logs').insert({
          action_type: 'legacy_wallet_drain_transfer_success',
          admin_id: user.id,
          target_id: candidate.userId,
          details: {
            wallet_id: candidate.walletId,
            transfer_id: transfer.id,
            amount_cents: candidate.amountCents,
          },
        });
        results.push({
          status: 'transferred',
          amountCents: candidate.amountCents,
        });
      } catch (error: unknown) {
        await supabaseAdmin.from('admin_audit_logs').insert({
          action_type: 'legacy_wallet_drain_transfer_failed',
          admin_id: user.id,
          target_id: candidate.userId,
          details: {
            wallet_id: candidate.walletId,
            amount_cents: candidate.amountCents,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        results.push({ status: 'failed', amountCents: candidate.amountCents });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        ...summarizeDrainResults(results),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === 'AUTH_REQUIRED'
        ? 401
        : message === 'ADMIN_REQUIRED'
          ? 403
          : 400;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
