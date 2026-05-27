import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '\*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'stripe-webhook',
      level,
      msg,
      ...data,
    }),
  );
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2025-12-15.clover',
  httpClient: Stripe.createFetchHttpClient(),
});

const APP_NAME = 'selene';

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('No signature', { status: 400 });

  let rawBody = '';

  try {
    rawBody = await req.text();
    const event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') || '',
    );

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { type, dispute_id, app_name, buyer_id, product_ids, address_id } =
        intent.metadata;

      if (type === 'return_shipping') {
        log('INFO', 'Procesando pago de retorno', {
          dispute_id,
          intentId: intent.id,
        });
        const { error } = await supabaseAdmin.rpc('fn_log_return_payment', {
          p_dispute_id: dispute_id,
          p_stripe_id: intent.id,
          p_amount: intent.amount / 100,
        });
        if (error)
          throw new Error(`Fallo en fn_log_return_payment: ${error.message}`);
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      }

      if (app_name === APP_NAME) {
        const productIdsArray = JSON.parse(product_ids || '[]');
        log('INFO', 'Procesando compra exitosa', {
          buyer_id,
          product_ids: productIdsArray,
        });

        const [{ data: settings }, { data: dbProducts }] = await Promise.all([
          supabaseAdmin.from('system_settings').select('*').single(),
          supabaseAdmin
            .from('products')
            .select('price')
            .in('id', productIdsArray),
        ]);

        if (!settings || !dbProducts)
          throw new Error('Configuración o productos no encontrados');

        const realSubtotalCents = Math.round(
          dbProducts.reduce((sum, p) => sum + Number(p.price), 0) * 100,
        );
        const expectedServiceFeeCents =
          Math.round(realSubtotalCents * settings.service_fee_pct) +
          settings.service_fee_fixed_cents;
        const expectedTotalCents = realSubtotalCents + expectedServiceFeeCents;

        if (Math.abs(intent.amount - expectedTotalCents) > 1) {
          log('ERROR', 'FRAUDE DETECTADO: El monto no coincide', {
            intent: intent.amount,
            expected: expectedTotalCents,
          });
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: productIdsArray,
          });
          return new Response(JSON.stringify({ error: 'Fraud detected' }), {
            status: 200,
          });
        }

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_create_order_from_payment',
          {
            p_buyer_id: buyer_id,
            p_stripe_intent_id: intent.id,
            p_product_ids: productIdsArray,
            p_address_id: address_id,
            p_total_amount: intent.amount / 100,
            p_service_fee: expectedServiceFeeCents / 100,
          },
        );

        if (rpcError || (rpcData && !rpcData[0]?.success)) {
          const errorMsg = rpcError?.message || rpcData?.[0]?.error_message;
          log('ERROR', 'Fallo al completar orden en DB (Rollback iniciado)', {
            error: errorMsg,
          });
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: productIdsArray,
          });
          throw new Error(`Fallo DB: ${errorMsg}`);
        }

        log('INFO', 'Orden completada y stock descontado con éxito', {
          buyer_id,
        });
      }
    }

    if (
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.canceled'
    ) {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { product_ids, app_name, type } = intent.metadata;

      if (app_name === APP_NAME && type !== 'return_shipping' && product_ids) {
        log('INFO', 'Pago fallido/cancelado, liberando productos', {
          product_ids,
        });
        await supabaseAdmin.rpc('fn_release_products', {
          p_product_ids: JSON.parse(product_ids),
        });
      }
    }

    if (event.type === 'setup_intent.succeeded') {
      const si = event.data.object as Stripe.SetupIntent;
      const { user_id, app_name } = si.metadata || {};

      if (app_name === APP_NAME && user_id) {
        const pmId = si.payment_method as string;
        const pm = await stripe.paymentMethods.retrieve(pmId);

        await supabaseAdmin.from('payment_methods').insert({
          user_id,
          stripe_payment_method_id: pmId,
          brand: pm.card?.brand,
          last4: pm.card?.last4,
          exp_month: pm.card?.exp_month,
          exp_year: pm.card?.exp_year,
        });
        log('INFO', 'Nuevo método de pago guardado', { user_id });
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err: any) {
    log('ERROR', 'Fallo crítico en Webhook', { error: err.message });

    try {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      let payloadObj = {};
      try {
        payloadObj = JSON.parse(rawBody || '{}');
      } catch (e) {}

      await supabaseAdmin.from('webhook_dlq').insert({
        event_type: (payloadObj as any).type || 'unknown_parse_error',
        payload: payloadObj,
        error_message: err.message || String(err),
      });
      log('INFO', 'Evento fallido guardado en DLQ exitosamente');
    } catch (dlqErr) {
      log('CRITICAL', 'Fallo catastrófico: No se pudo guardar en DLQ', {
        error: String(dlqErr),
      });
    }

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
});
