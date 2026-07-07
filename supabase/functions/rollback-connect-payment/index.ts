import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

import {
  buildConnectRollbackRefundParams,
  extractProductIdsFromIntentMetadata,
  mergeUniqueProductIds,
} from './rollback-connect-payment.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RequestSchema = z.object({
  orderId: z.string().min(1),
  paymentIntentIds: z.array(z.string().min(1)).min(1).max(20),
});

const log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'rollback-connect-payment',
      level,
      msg,
      ...meta,
    }),
  );
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('AUTH_REQUIRED');

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    const { orderId, paymentIntentIds } = RequestSchema.parse(
      await req.json().catch(() => ({})),
    );

    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    const intents: Array<{
      paymentIntentId: string;
      intent: Stripe.PaymentIntent;
      productIds: string[];
    }> = [];

    for (const paymentIntentId of paymentIntentIds) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.metadata?.buyer_id !== user.id) {
        throw new Error('PAYMENT_INTENT_NOT_OWNED_BY_USER');
      }

      const parsedProductIds = extractProductIdsFromIntentMetadata(
        intent.metadata,
      );
      if (parsedProductIds.malformed) {
        log('warn', 'Malformed product metadata skipped', {
          paymentIntentId,
        });
      }

      intents.push({
        paymentIntentId,
        intent,
        productIds: parsedProductIds.productIds,
      });
    }

    let rolledBack = 0;
    let productIdsToRelease: string[] = [];
    for (const { paymentIntentId, intent, productIds } of intents) {
      if (intent.status === 'succeeded') {
        await stripe.refunds.create(
          buildConnectRollbackRefundParams({ paymentIntentId, orderId }),
          { idempotencyKey: `checkout_rollback_${orderId}_${paymentIntentId}` },
        );
        rolledBack += 1;
        productIdsToRelease = mergeUniqueProductIds(
          productIdsToRelease,
          productIds,
        );
      } else if (
        [
          'requires_payment_method',
          'requires_confirmation',
          'requires_action',
        ].includes(intent.status)
      ) {
        await stripe.paymentIntents.cancel(paymentIntentId);
        rolledBack += 1;
        productIdsToRelease = mergeUniqueProductIds(
          productIdsToRelease,
          productIds,
        );
      }
    }

    if (productIdsToRelease.length > 0) {
      const { data, error } = await supabaseAdmin.rpc('fn_release_products', {
        p_product_ids: productIdsToRelease,
      });

      if (error) {
        log('error', 'Product release failed after Stripe rollback', {
          orderId,
          productIds: productIdsToRelease,
          error: error.message,
        });
      } else if (
        Array.isArray(data) &&
        data.some((row) => row && row.success === false)
      ) {
        log('error', 'Product release returned unsuccessful result', {
          orderId,
          productIds: productIdsToRelease,
          data,
        });
      } else {
        log('info', 'Reserved products released after Stripe rollback', {
          orderId,
          productIds: productIdsToRelease,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, rolledBack }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, rolledBack: 0, error: message }),
      {
        status: message === 'AUTH_REQUIRED' ? 401 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
