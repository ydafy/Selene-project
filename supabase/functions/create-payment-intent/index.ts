import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

// --- CONFIGURATION ---
const APP_NAME = 'selene';
const STRIPE_API_VERSION = '2025-12-15.clover';
const SERVICE_FEE_PERCENT = 0.05;
const SERVICE_FEE_FIXED_CENTS = 500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key',
};

const RequestSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1),
  addressId: z.string().uuid(),
  idempotencyKey: z.string().optional(),
});

const log = (
  level: 'info' | 'error' | 'warn',
  message: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      function: 'create-payment-intent',
      ...meta,
    }),
  );
};

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    log('info', '--- Starting Payment Intent Creation ---');

    // 1. VALIDATE SECRETS
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) throw new Error('MISSING_STRIPE_KEY');

    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 2. AUTHENTICATION
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('AUTH_REQUIRED');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    // 3. INPUT VALIDATION
    const body = await req.json();
    log('info', 'Request body received', { body });

    const result = RequestSchema.safeParse(body);
    if (!result.success) {
      log('error', 'Zod validation failed', { errors: result.error.format() });
      throw new Error('INVALID_INPUT');
    }
    const { productIds, addressId, idempotencyKey } = result.data;

    // 4. ATOMIC RESERVATION (RPC)
    const { data: reserveData, error: rpcError } = await supabaseClient.rpc(
      'fn_reserve_products',
      {
        p_product_ids: productIds,
        p_buyer_id: user.id,
      },
    );

    const reservation = reserveData?.[0];
    if (rpcError || !reservation?.success) {
      log('warn', 'Inventory lock failed', {
        error: rpcError?.message || reservation?.error_message,
      });
      throw new Error(reservation?.error_message || 'STOCK_UNAVAILABLE');
    }

    // 5. FINANCIAL CALCULATIONS
    const subtotalFromDB = Number(reservation.total_price);
    const subtotalCents = Math.round(subtotalFromDB * 100);
    const serviceFeeCents =
      Math.round(subtotalCents * SERVICE_FEE_PERCENT) + SERVICE_FEE_FIXED_CENTS;
    const totalCents = subtotalCents + serviceFeeCents;

    // 6. STRIPE CUSTOMER IDENTITY
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    const customerId = profile?.stripe_customer_id;
    if (!customerId) throw new Error('STRIPE_CUSTOMER_NOT_FOUND');

    // 7. EPHEMERAL KEY (Para tarjetas guardadas)
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: STRIPE_API_VERSION },
    );

    // 8. CREATE PAYMENT INTENT
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: 'mxn',
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        metadata: {
          buyer_id: user.id,
          product_ids: JSON.stringify(productIds),
          address_id: addressId,
          app_name: APP_NAME,
          subtotal: subtotalFromDB.toString(),
        },
      },
      {
        idempotencyKey: idempotencyKey || crypto.randomUUID(),
      },
    );

    log('info', 'PaymentIntent created successfully', {
      intentId: paymentIntent.id,
    });

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        ephemeralKey: ephemeralKey.secret,
        customer: customerId,
        amount: totalCents / 100,
        subtotal: subtotalFromDB,
        serviceFee: serviceFeeCents / 100,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    const message = error.message || String(error);

    // Stripe specific handling
    if (message.toLowerCase().includes('stripe')) {
      log('error', 'Stripe API Error', { error: message });
      return new Response(JSON.stringify({ error: 'PAYMENT_PROVIDER_ERROR' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const statusMap: Record<string, number> = {
      AUTH_REQUIRED: 401,
      INVALID_INPUT: 422,
      STOCK_UNAVAILABLE: 409,
      STRIPE_CUSTOMER_NOT_FOUND: 400,
      MISSING_STRIPE_KEY: 500,
    };

    const status = statusMap[message] || 400;
    log('error', 'Request failed', { message, status });

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
