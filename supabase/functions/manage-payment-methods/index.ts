import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2025-12-15.clover',
  httpClient: Stripe.createFetchHttpClient(),
});

const APP_NAME = 'selene';

// FUNCIÓN DE FALLBACK PARA UUID (Universal)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    console.log('[MANAGE-PAYMENT-METHODS] Request received');
    console.log('[MANAGE-PAYMENT-METHODS] Method:', req.method);
    console.log(
      '[MANAGE-PAYMENT-METHODS] Headers:',
      Object.fromEntries(req.headers.entries()),
    );

    const authHeader = req.headers.get('Authorization');
    console.log(
      '[MANAGE-PAYMENT-METHODS] Auth header:',
      authHeader ? authHeader.substring(0, 20) + '...' : 'MISSING',
    );
    if (!authHeader) throw new Error('MISSING_AUTH_HEADER');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();
    console.log('[MANAGE-PAYMENT-METHODS] Auth result:', {
      user: user?.id,
      authError: authError?.message,
    });
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    let requestBody;
    try {
      requestBody = await req.json();
      console.log('[MANAGE-PAYMENT-METHODS] Request body:', requestBody);
    } catch (jsonError) {
      console.error('[MANAGE-PAYMENT-METHODS] JSON parse error:', jsonError);
      throw new Error('INVALID_JSON_BODY');
    }

    const { action, paymentMethodId } = requestBody;

    let { data: profile } = await supabaseClient
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabaseClient
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    switch (action) {
      case 'get_setup_config': {
        console.log(
          '[MANAGE-PAYMENT-METHODS] Processing get_setup_config for user:',
          user.id,
        );

        const { count, error: countError } = await supabaseClient
          .from('payment_methods')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id);

        console.log(
          '[MANAGE-PAYMENT-METHODS] Payment methods count:',
          count,
          'Error:',
          countError,
        );

        if (count && count >= 3) throw new Error('PAYMENT_LIMIT_REACHED');

        // CORRECCIÓN: Usamos nuestro generador universal
        const idempotencyKey =
          req.headers.get('idempotency-key') || generateUUID();

        const ephemeralKey = await stripe.ephemeralKeys.create(
          { customer: customerId },
          { apiVersion: '2022-11-15' },
        );
        console.log('[MANAGE-PAYMENT-METHODS] Ephemeral key created');

        const setupIntent = await stripe.setupIntents.create(
          {
            customer: customerId,
            payment_method_types: ['card'],
            metadata: { user_id: user.id, app_name: APP_NAME },
          },
          { idempotencyKey },
        );
        console.log('[MANAGE-PAYMENT-METHODS] Setup intent created');

        const responseData = {
          setupIntent: setupIntent.client_secret,
          ephemeralKey: ephemeralKey.secret,
          customer: customerId,
          publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
        };
        console.log('[MANAGE-PAYMENT-METHODS] Returning setup config');

        return new Response(JSON.stringify(responseData), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'list_payment_methods': {
        console.log(
          '[MANAGE-PAYMENT-METHODS] Processing list_payment_methods for user:',
          user.id,
        );

        const { data: methods, error: listError } = await supabaseClient
          .from('payment_methods')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        console.log(
          '[MANAGE-PAYMENT-METHODS] Payment methods found:',
          methods?.length || 0,
          'Error:',
          listError,
        );

        return new Response(JSON.stringify({ methods: methods || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete_payment_method': {
        const { data: pm } = await supabaseClient
          .from('payment_methods')
          .select('stripe_payment_method_id')
          .eq('id', paymentMethodId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!pm) {
          // Si no está en nuestra DB, para nosotros ya está borrada
          return new Response(
            JSON.stringify({ success: true, message: 'Already deleted' }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        try {
          // Intentamos desvincular de Stripe
          await stripe.paymentMethods.detach(pm.stripe_payment_method_id);
          console.log(
            `[STRIPE] Tarjeta ${pm.stripe_payment_method_id} desvinculada.`,
          );
        } catch (stripeError) {
          // Si Stripe da error (ej: la tarjeta ya no existe allá),
          // logueamos pero NO lanzamos error para poder limpiar nuestra DB.
          console.warn(
            `[STRIPE WARNING] No se pudo desvincular en Stripe: ${stripeError.message}`,
          );
        }

        // Borramos de nuestra DB pase lo que pase con Stripe
        const { error: dbError } = await supabaseClient
          .from('payment_methods')
          .delete()
          .eq('id', paymentMethodId);

        if (dbError) throw new Error(`DB_DELETE_FAILED: ${dbError.message}`);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      default:
        console.log('[MANAGE-PAYMENT-METHODS] Invalid action:', action);
        throw new Error('INVALID_ACTION');
    }
  } catch (error) {
    console.error(
      '[MANAGE-PAYMENT-METHODS] ERROR:',
      error.message,
      'Stack:',
      error.stack,
    );
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
