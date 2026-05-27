import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

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
      function: 'generate-return-label',
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
      apiVersion: '2025-12-15.clover',
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
        .select('id, seller_id, status, order_id, buyer_id')
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

    if (dispute.buyer_id !== user.id)
      throw new ApiError(
        403,
        'Solo el comprador puede generar la guía de retorno',
      );
    if (dispute.status !== 'waiting_return')
      throw new ApiError(422, 'La disputa no está en fase de retorno');

    const returnFeeCents = settingsRes.data?.return_label_fee_cents || 30000; // Fallback $300

    // 3. Obtener Stripe Customer
    const { data: profile } = await supabaseAdmin
      .from('profiles_private')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (!profile?.stripe_customer_id)
      throw new ApiError(
        400,
        'El usuario no tiene un perfil de Stripe configurado',
      );

    // 4. Generar Ephemeral Key y Payment Intent
    log('INFO', 'Creando Payment Intent para retorno', {
      disputeId,
      sellerId: user.id,
      amount: returnFeeCents,
    });

    const [ephemeralKey, paymentIntent] = await Promise.all([
      stripe.ephemeralKeys.create(
        { customer: profile.stripe_customer_id },
        { apiVersion: '2022-11-15' },
      ),
      stripe.paymentIntents.create(
        {
          amount: returnFeeCents,
          currency: 'mxn',
          customer: profile.stripe_customer_id,
          automatic_payment_methods: { enabled: true },
          metadata: {
            type: 'return_shipping',
            dispute_id: disputeId,
            order_id: dispute.order_id,
            seller_id: user.id,
          },
        },
        { idempotencyKey: `return_pay_${disputeId}` },
      ),
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
