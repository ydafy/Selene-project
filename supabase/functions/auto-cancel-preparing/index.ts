import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'auto-cancel-preparing',
      level,
      msg,
      ...data,
    }),
  );
};

serve(async (req) => {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    log('INFO', 'Iniciando proceso de auto-cancelación de preparing');

    // 0. Evitar ejecución concurrente — lock por 10 minutos
    const { data: lock } = await supabaseAdmin
      .from('system_settings')
      .select('auto_cancel_preparing_running')
      .single();

    if (lock?.auto_cancel_preparing_running) {
      log(
        'WARN',
        'Otro proceso de auto-cancel-preparing está corriendo, saliendo',
      );
      return new Response(JSON.stringify({ message: 'Already running' }), {
        status: 200,
      });
    }

    await supabaseAdmin
      .from('system_settings')
      .update({ auto_cancel_preparing_running: true })
      .eq('id', 1);

    // 1. Obtener configuración — preparing usa timeout separado (72h default)
    //    72h balancea experiencia del buyer (no esperar demasiado) con la realidad
    //    del seller (carrier scan delays). Si se detectan cancelaciones injustas
    //    en producción, subir a 96h desde el dashboard sin deploy.
    const { data: settings } = await supabaseAdmin
      .from('system_settings')
      .select('preparing_expiration_hours')
      .single();

    const hours = settings?.preparing_expiration_hours || 72;
    const expirationLimit = new Date(
      Date.now() - hours * 60 * 60 * 1000,
    ).toISOString();

    // 2. Buscar shipments atascados en 'preparing' sin escaneo de paquetería
    //    Usamos updated_at (no created_at) porque el timer empieza desde
    //    que se generó la guía, no desde que se creó la orden.
    //    No filtramos por tracking_number IS NULL: incluso las guías generadas
    //    que nunca recibieron escaneo deben cancelarse por seguridad.
    const { data: expiredShipments, error: fetchError } = await supabaseAdmin
      .from('shipments')
      .select('id, order_id, seller_id, stripe_payment_intent_id')
      .eq('status', 'preparing')
      .lt('updated_at', expirationLimit)
      .limit(50);

    if (fetchError) throw fetchError;
    if (!expiredShipments || expiredShipments.length === 0) {
      log('INFO', 'No hay shipments en preparing para cancelar');

      // Liberar lock antes de salir
      await supabaseAdmin
        .from('system_settings')
        .update({ auto_cancel_preparing_running: false })
        .eq('id', 1);

      return new Response(
        JSON.stringify({ message: 'No preparing shipments to cancel' }),
        { status: 200 },
      );
    }

    log(
      'INFO',
      `Procesando ${expiredShipments.length} shipments atascados en preparing`,
    );

    let successCount = 0;

    for (const shipment of expiredShipments) {
      try {
        // 3. Calcular monto del shipment para refund parcial en Stripe
        const { data: orderItems } = await supabaseAdmin
          .from('order_items')
          .select('price_at_purchase, shipping_amount')
          .eq('shipment_id', shipment.id);

        const refundItems = (orderItems ?? []) as Array<{
          price_at_purchase: number;
          shipping_amount: number | null;
        }>;

        const refundAmountCents = Math.round(
          refundItems.reduce(
            (sum, item) =>
              sum + item.price_at_purchase + (item.shipping_amount ?? 0),
            0,
          ) * 100,
        );

        // 4. Resolve PaymentIntent ID: Connect uses shipment-level PI,
        // legacy uses order-level PI (NULL for Connect per T-001).
        const stripePaymentIntentId = shipment.stripe_payment_intent_id ?? null;
        let orderStripeIntentId: string | null = null;

        if (!stripePaymentIntentId) {
          const { data: order } = await supabaseAdmin
            .from('orders')
            .select('stripe_payment_intent_id')
            .eq('id', shipment.order_id)
            .single();
          orderStripeIntentId = order?.stripe_payment_intent_id ?? null;
        }

        const finalStripeIntentId =
          stripePaymentIntentId ?? orderStripeIntentId;

        // 5. Stripe refund parcial (solo el monto de este shipment)
        if (finalStripeIntentId && refundAmountCents > 0) {
          try {
            const refundParams: Stripe.RefundCreateParams = {
              payment_intent: finalStripeIntentId,
              amount: refundAmountCents,
              reason: 'requested_by_customer' as const,
              metadata: {
                shipment_id: shipment.id,
                order_id: shipment.order_id,
                type: 'auto_cancel_preparing',
              },
            };

            if (stripePaymentIntentId) {
              refundParams.reverse_transfer = true;
            }

            await stripe.refunds.create(refundParams, {
              idempotencyKey: `auto_cancel_preparing_${shipment.id}`,
            });
          } catch (stripeError: unknown) {
            if (
              typeof stripeError === 'object' &&
              stripeError !== null &&
              'code' in stripeError &&
              (stripeError as { code: string }).code ===
                'charge_already_refunded'
            ) {
              log('INFO', 'Stripe refund idempotente — ya reembolsado', {
                shipmentId: shipment.id,
              });
            } else {
              throw stripeError;
            }
          }
        }

        // 6. Cancelar shipment vía RPC atómica (wallet, products, status, notifications)
        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_cancel_shipment',
          {
            p_shipment_id: shipment.id,
            p_cancelled_by_role: 'system',
            p_reason: `Cancelación automática: Envío en preparación por más de ${hours} horas sin escaneo del carrier.`,
          },
        );

        const success = rpcData?.[0]?.success ?? false;

        if (rpcError || !success) {
          const errorMsg = rpcError?.message || rpcData?.[0]?.error_message;

          // Stripe refund already processed but DB failed → flag for admin review
          if (errorMsg === 'ALREADY_CANCELLED') {
            log('INFO', `Shipment ${shipment.id} already cancelled, skipping`, {
              shipmentId: shipment.id,
            });
          } else {
            log(
              'CRITICAL',
              `Stripe refund OK pero DB cancel falló — requiere revision manual`,
              {
                shipmentId: shipment.id,
                orderId: shipment.order_id,
                refundAmountCents,
                error: errorMsg,
              },
            );
          }
        } else {
          successCount++;
          log('INFO', 'Shipment en preparing cancelado exitosamente', {
            shipmentId: shipment.id,
            orderId: shipment.order_id,
            refundAmountCents,
          });
        }

        // Delay para no saturar Stripe API
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        log('ERROR', `Excepción en loop para shipment ${shipment.id}`, {
          orderId: shipment.order_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log('INFO', 'Proceso de auto-cancelación de preparing finalizado', {
      total: expiredShipments.length,
      success: successCount,
    });

    // 7. Liberar lock
    await supabaseAdmin
      .from('system_settings')
      .update({ auto_cancel_preparing_running: false })
      .eq('id', 1);

    return new Response(
      JSON.stringify({
        processed: expiredShipments.length,
        success: successCount,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    // Liberar lock en caso de error crítico
    await supabaseAdmin
      .from('system_settings')
      .update({ auto_cancel_preparing_running: false })
      .eq('id', 1);

    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'Fallo crítico en auto-cancel-preparing', {
      error: message,
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
});
