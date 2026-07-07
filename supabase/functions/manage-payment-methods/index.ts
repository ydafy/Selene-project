import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const APP_NAME = 'selene';
const STRIPE_API_VERSION = '2026-04-22.dahlia';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'manage-payment-methods',
      level,
      msg,
      ...data,
    }),
  );
};

const RequestSchema = z.object({
  action: z.enum([
    'get_setup_config',
    'list_payment_methods',
    'delete_payment_method',
  ]),
  paymentMethodId: z.string().uuid().optional(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. Validar Identidad
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('MISSING_AUTH_HEADER');

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    // 2. Validar Input
    const body = await req.json().catch(() => ({}));
    const { action, paymentMethodId } = RequestSchema.parse(body);

    // 3. Asegurar Stripe Customer
    let { data: profile } = await supabaseAdmin
      .from('profiles_private')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      log('INFO', 'Creando nuevo Stripe Customer', { userId: user.id });
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('profiles_private')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    switch (action) {
      case 'get_setup_config': {
        // Solo contamos tarjetas activas
        const { count } = await supabaseAdmin
          .from('payment_methods')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .is('deleted_at', null);

        if (count && count >= 3) throw new Error('PAYMENT_LIMIT_REACHED');

        const [ephemeralKey, setupIntent] = await Promise.all([
          stripe.ephemeralKeys.create(
            { customer: customerId },
            { apiVersion: STRIPE_API_VERSION },
          ),
          stripe.setupIntents.create(
            {
              customer: customerId,
              payment_method_types: ['card'],
              metadata: { user_id: user.id, app_name: APP_NAME },
            },
            {
              idempotencyKey:
                req.headers.get('idempotency-key') || crypto.randomUUID(),
            },
          ),
        ]);

        return new Response(
          JSON.stringify({
            setupIntent: setupIntent.client_secret,
            ephemeralKey: ephemeralKey.secret,
            customer: customerId,
            publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      case 'list_payment_methods': {
        const { data: methods } = await supabaseAdmin
          .from('payment_methods')
          .select('*')
          .eq('user_id', user.id)
          .is('deleted_at', null) // Filtrar las borradas
          .order('created_at', { ascending: false });

        return new Response(JSON.stringify({ methods: methods || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete_payment_method': {
        if (!paymentMethodId) throw new Error('PAYMENT_METHOD_ID_REQUIRED');

        const { data: pm } = await supabaseAdmin
          .from('payment_methods')
          .select('stripe_payment_method_id')
          .eq('id', paymentMethodId)
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .maybeSingle();

        if (!pm) {
          return new Response(
            JSON.stringify({ success: true, message: 'Already deleted' }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        try {
          await stripe.paymentMethods.detach(pm.stripe_payment_method_id);
          log('INFO', 'Tarjeta desvinculada de Stripe', {
            pmId: pm.stripe_payment_method_id,
          });
        } catch (stripeError: any) {
          log('WARN', 'Fallo al desvincular en Stripe (continuando con DB)', {
            error: stripeError.message,
          });
        }

        // SOFT DELETE: No usamos .delete(), usamos .update()
        const { error: dbError } = await supabaseAdmin
          .from('payment_methods')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', paymentMethodId);

        if (dbError) throw new Error(`DB_DELETE_FAILED: ${dbError.message}`);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        throw new Error('INVALID_ACTION');
    }
  } catch (error: any) {
    log('ERROR', 'Excepción en gestión de pagos', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
