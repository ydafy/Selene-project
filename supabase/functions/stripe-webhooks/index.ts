import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.0.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2025-12-15.clover',
  httpClient: Stripe.createFetchHttpClient(),
});

const APP_NAME = 'selene';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('No signature', { status: 400 });

  try {
    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') || '',
    );

    // VALIDACIÓN DE CONFIGURACIÓN (Sugerencia IA Local)
    const serviceRoleKey =
      Deno.env.get('SELENE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceRoleKey) {
      console.error('[CRITICAL] Service role key not configured');
      return new Response('Server configuration error', { status: 500 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
    );

    const processEvent = async () => {
      // --- PAGO EXITOSO ---
      if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object as Stripe.PaymentIntent;
        const { buyer_id, product_ids, address_id, app_name, subtotal } =
          intent.metadata;
        if (app_name !== APP_NAME) return;

        const productIdsArray = JSON.parse(product_ids);
        // 1. OBTENER PRECIOS REALES DE LA DB (Seguridad nivel Pro)
        const { data: dbProducts } = await supabaseAdmin
          .from('products')
          .select('price')
          .in('id', productIdsArray);

        const realSubtotal =
          dbProducts?.reduce((sum, p) => sum + Number(p.price), 0) || 0;
        const realSubtotalCents = Math.round(realSubtotal * 100);
        const expectedServiceFeeCents =
          Math.round(realSubtotalCents * 0.05) + 500;
        const expectedTotalCents = realSubtotalCents + expectedServiceFeeCents;

        // 2. COMPARAR CON LO COBRADO POR STRIPE
        if (Math.abs(intent.amount - expectedTotalCents) > 1) {
          // Margen de 1 centavo por redondeo
          console.error('[FRAUD ALERT] Monto cobrado no coincide con DB', {
            charged: intent.amount,
            expected: expectedTotalCents,
          });
          // Liberamos productos y no creamos orden
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: productIdsArray,
          });
          return new Response('Amount Mismatch', { status: 400 });
        }

        const totalAmount = intent.amount / 100;
        const serviceFee = expectedServiceFeeCents / 100;

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_complete_order',
          {
            p_buyer_id: buyer_id,
            p_stripe_intent_id: intent.id,
            p_product_ids: productIdsArray,
            p_address_id: address_id,
            p_total_amount: totalAmount,
            p_service_fee: serviceFee,
          },
        );

        if (rpcError || (rpcData && !rpcData[0]?.success)) {
          console.error(
            '[CRITICAL] Order failed, rollbacking stock:',
            rpcError?.message || rpcData[0]?.error_message,
          );
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: productIdsArray,
          });
        }
      }

      // --- PAGO FALLIDO / CANCELADO ---
      if (
        event.type === 'payment_intent.payment_failed' ||
        event.type === 'payment_intent.canceled'
      ) {
        const intent = event.data.object as Stripe.PaymentIntent;
        const { product_ids, app_name } = intent.metadata;
        if (app_name === APP_NAME && product_ids) {
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: JSON.parse(product_ids),
          });
        }
      }

      // --- SETUP INTENT (TARJETAS) ---
      if (event.type === 'setup_intent.succeeded') {
        const si = event.data.object as Stripe.SetupIntent;
        const { user_id, app_name } = si.metadata || {};
        if (app_name === APP_NAME && user_id) {
          const pmId = si.payment_method as string;
          const { data: existing } = await supabaseAdmin
            .from('payment_methods')
            .select('id')
            .eq('stripe_payment_method_id', pmId)
            .maybeSingle();
          if (!existing) {
            const pm = await stripe.paymentMethods.retrieve(pmId);
            await supabaseAdmin.from('payment_methods').insert({
              user_id,
              stripe_payment_method_id: pmId,
              brand: pm.card?.brand,
              last4: pm.card?.last4,
              exp_month: pm.card?.exp_month,
              exp_year: pm.card?.exp_year,
            });
          }
        }
      }
    };

    processEvent().catch((err) =>
      console.error('[WEBHOOK PROCESS ERROR]', err),
    );
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    // MANEJO DE ERROR ROBUSTO (Sugerencia IA Local)
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[WEBHOOK CRITICAL ERROR] ${message}`);
    return new Response(`Error: ${message}`, { status: 400 });
  }
});
