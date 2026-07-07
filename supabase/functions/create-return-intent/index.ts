import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

import { buildReturnShippingPaymentIntentParams } from './create-return-intent.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'create-return-intent',
      level,
      msg,
      ...data,
    }),
  );
};

const RequestSchema = z.object({
  disputeId: z.string().uuid('ID de disputa inválido'),
});

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { disputeId } = RequestSchema.parse(body);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 1. Autenticación
    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );
    if (authError || !user) throw new ApiError(401, 'No autorizado');

    // 2. Fetch de Datos (Disputa + Settings)
    const [disputeRes, settingsRes] = await Promise.all([
      supabaseAdmin
        .from('disputes')
        .select('id, seller_id, status, order_id, shipment_id')
        .eq('id', disputeId)
        .single(),
      supabaseAdmin
        .from('system_settings')
        .select('return_label_fee_cents')
        .single(),
    ]);

    if (disputeRes.error || !disputeRes.data)
      throw new ApiError(404, 'Disputa no encontrada');
    const dispute = disputeRes.data;

    // 3. Validación centralizada via RPC (evita duplicar lógica)
    const { data: initResult, error: initError } = await supabaseAdmin.rpc(
      'fn_seller_initiate_return_label',
      {
        p_dispute_id: disputeId,
        p_caller_id: user.id,
      },
    );

    if (initError || !initResult?.[0]?.success) {
      const errMsg =
        initResult?.[0]?.error_message ||
        initError?.message ||
        'Operación no permitida';
      throw new ApiError(400, errMsg);
    }

    const returnFeeCents = settingsRes.data?.return_label_fee_cents || 30000; // Fallback $300

    if (!dispute.shipment_id) {
      throw new ApiError(400, 'Dispute is not linked to a shipment');
    }

    // 4. Load seller Stripe customer and connected account.
    const { data: profile } = await supabaseAdmin
      .from('profiles_private')
      .select('stripe_customer_id, stripe_account_id')
      .eq('id', dispute.seller_id)
      .single();
    if (!profile?.stripe_customer_id)
      throw new ApiError(
        400,
        'Seller does not have a Stripe customer configured',
      );
    if (!profile?.stripe_account_id)
      throw new ApiError(
        400,
        'Seller does not have a Stripe Connect account configured',
      );

    // 5. Generar Ephemeral Key y Payment Intent
    log('INFO', 'Creando Payment Intent para retorno', {
      disputeId,
      sellerId: dispute.seller_id,
      stripeAccountId: profile.stripe_account_id,
      amount: returnFeeCents,
    });

    const { params: paymentIntentParams, options: paymentIntentOptions } =
      buildReturnShippingPaymentIntentParams({
        amountCents: returnFeeCents,
        customerId: profile.stripe_customer_id,
        disputeId,
        orderId: dispute.order_id,
        sellerId: dispute.seller_id,
        shipmentId: dispute.shipment_id,
        stripeAccountId: profile.stripe_account_id,
      });

    const [ephemeralKey, paymentIntent] = await Promise.all([
      stripe.ephemeralKeys.create(
        { customer: profile.stripe_customer_id },
        { apiVersion: STRIPE_API_VERSION },
      ),
      stripe.paymentIntents.create(paymentIntentParams, paymentIntentOptions),
    ]);

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        ephemeralKey: ephemeralKey.secret,
        customer: profile.stripe_customer_id,
        amount: returnFeeCents / 100,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    const status = error instanceof ApiError ? error.status : 400;
    log('ERROR', 'Fallo al crear intent de retorno', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
