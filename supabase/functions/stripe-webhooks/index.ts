import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.0.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2022-11-15',
  httpClient: Stripe.createFetchHttpClient(),
});

// Configuración
const APP_NAME = 'selene';
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const MAX_REQUESTS_PER_WINDOW = 100;

// Rate limiting simple en memoria
const requestCounts = new Map<string, { count: number; resetTime: number }>();

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
      function: 'stripe-webhooks',
      ...meta,
    }),
  );
};

// Rate limiting
const checkRateLimit = (clientIP: string): boolean => {
  const now = Date.now();
  const clientData = requestCounts.get(clientIP);

  if (!clientData || now > clientData.resetTime) {
    requestCounts.set(clientIP, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return true;
  }

  if (clientData.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  clientData.count++;
  return true;
};

serve(async (req) => {
  const clientIP = req.headers.get('x-forwarded-for') || 'unknown';

  // Rate limiting
  if (!checkRateLimit(clientIP)) {
    log('warn', 'Rate limit exceeded', { clientIP });
    return new Response('Rate limit exceeded', { status: 429 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    log('error', 'Missing stripe-signature header');
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') || '',
    );

    log('info', 'Webhook received', {
      eventType: event.type,
      eventId: event.id,
    });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Procesar evento de forma asíncrona (no bloquear respuesta)
    const processEvent = async () => {
      if (event.type === 'setup_intent.succeeded') {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        const userId = setupIntent.metadata?.user_id;
        const paymentMethodId = setupIntent.payment_method as string;

        // Validar que el webhook viene de nuestra app
        if (setupIntent.metadata?.app_name !== APP_NAME) {
          log('warn', 'Invalid app_name in metadata', {
            received: setupIntent.metadata?.app_name,
            expected: APP_NAME,
          });
          return;
        }

        if (userId && paymentMethodId) {
          try {
            // Verificar si ya existe
            const { data: existing } = await supabaseAdmin
              .from('payment_methods')
              .select('id')
              .eq('stripe_payment_method_id', paymentMethodId)
              .single();

            if (!existing) {
              const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

              const { error } = await supabaseAdmin
                .from('payment_methods')
                .insert({
                  user_id: userId,
                  stripe_payment_method_id: paymentMethodId,
                  brand: pm.card?.brand,
                  last4: pm.card?.last4,
                  exp_month: pm.card?.exp_month,
                  exp_year: pm.card?.exp_year,
                  is_default: false,
                });

              if (error) {
                log('error', 'DB Insert failed', {
                  error: error.message,
                  userId,
                  paymentMethodId,
                });
              } else {
                log('info', 'Payment method saved', {
                  userId,
                  paymentMethodId,
                  brand: pm.card?.brand,
                });
              }
            } else {
              log('info', 'Payment method already exists, skipping', {
                paymentMethodId,
              });
            }
          } catch (err) {
            log('error', 'Error processing setup_intent.succeeded', {
              error: err.message,
              userId,
              paymentMethodId,
            });
          }
        }
      }

      if (event.type === 'setup_intent.failed') {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        const userId = setupIntent.metadata?.user_id;
        const errorMessage = setupIntent.last_setup_error?.message;

        log('error', 'Setup intent failed', {
          userId,
          error: errorMessage,
          setupIntentId: setupIntent.id,
        });

        // Métrica de fallo
        log('info', 'Metric: payment_method_setup_failed', { count: 1 });
      }
    };

    // Ejecutar sin esperar (asíncrono)
    processEvent().catch((err) => {
      log('error', 'Unhandled error in processEvent', { error: err.message });
    });

    // Responder 200 inmediatamente
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    log('error', 'Webhook processing error', {
      error: err.message,
      clientIP,
    });
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
});
