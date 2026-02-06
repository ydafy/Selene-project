import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const APP_NAME = 'selene';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2022-11-15',
  httpClient: Stripe.createFetchHttpClient(),
});

// Helper de logging estructurado
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
      function: 'manage-payment-methods',
      ...meta,
    }),
  );
};

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      },
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      log('warn', 'Authentication failed', { error: authError?.message });
      throw new Error('AUTH_REQUIRED');
    }

    const { action, paymentMethodId } = await req.json();

    log('info', 'Action received', { action, userId: user.id });

    // Health check endpoint
    if (action === 'health') {
      try {
        await stripe.customers.list({ limit: 1 });
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      } catch (err) {
        log('error', 'Health check failed', { error: err.message });
        return new Response(
          JSON.stringify({ status: 'error', message: err.message }),
          { status: 503 },
        );
      }
    }

    // Obtener Perfil
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('stripe_customer_id, username')
      .eq('id', user.id)
      .single();

    if (profileError) {
      log('error', 'Profile not found', {
        userId: user.id,
        error: profileError.message,
      });
      throw new Error('PROFILE_NOT_FOUND');
    }

    let customerId = profile.stripe_customer_id;

    // Crear cliente si no existe
    if (!customerId) {
      log('info', 'Creating new Stripe customer', { userId: user.id });
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabaseClient
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
      log('info', 'Stripe customer created', { userId: user.id, customerId });
    }

    switch (action) {
      case 'get_setup_config': {
        const { count } = await supabaseClient
          .from('payment_methods')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id);

        if (count && count >= 3) {
          log('warn', 'Payment method limit reached', {
            userId: user.id,
            count,
          });
          throw new Error('PAYMENT_LIMIT_REACHED');
        }

        const ephemeralKey = await stripe.ephemeralKeys.create(
          { customer: customerId },
          { apiVersion: '2022-11-15' },
        );

        // Idempotencia: usar header del cliente o generar UUID
        const idempotencyKey =
          req.headers.get('idempotency-key') || crypto.randomUUID();

        const setupIntent = await stripe.setupIntents.create(
          {
            customer: customerId,
            payment_method_types: ['card'],
            metadata: { user_id: user.id, app_name: APP_NAME },
          },
          { idempotencyKey },
        );

        log('info', 'Setup config generated', { userId: user.id, customerId });

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
        const { data: methods, error: listError } = await supabaseClient
          .from('payment_methods')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (listError) {
          log('error', 'Failed to list payment methods', {
            userId: user.id,
            error: listError.message,
          });
          throw listError;
        }

        log('info', 'Payment methods listed', {
          userId: user.id,
          count: methods?.length || 0,
        });

        return new Response(JSON.stringify({ methods }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete_payment_method': {
        if (!paymentMethodId) {
          throw new Error('PAYMENT_METHOD_ID_REQUIRED');
        }

        const { data: pm, error: findError } = await supabaseClient
          .from('payment_methods')
          .select('stripe_payment_method_id')
          .eq('id', paymentMethodId)
          .eq('user_id', user.id)
          .single();

        if (findError || !pm) {
          log('warn', 'Payment method not found for deletion', {
            userId: user.id,
            paymentMethodId,
          });
          throw new Error('PAYMENT_METHOD_NOT_FOUND');
        }

        await stripe.paymentMethods.detach(pm.stripe_payment_method_id);
        await supabaseClient
          .from('payment_methods')
          .delete()
          .eq('id', paymentMethodId);

        log('info', 'Payment method deleted', {
          userId: user.id,
          paymentMethodId,
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        log('warn', 'Invalid action', { action, userId: user.id });
        throw new Error('INVALID_ACTION');
    }
  } catch (error) {
    log('error', 'Request processing error', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
