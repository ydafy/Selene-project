import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';
import { withSentry } from '../_shared/sentry.ts';
import {
  disputeRefundAmountCents,
  extractRefundId,
  refundBlockedReason,
  refundIntentBlockedReason,
} from './resolve-dispute-refund.ts';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'resolve-dispute-refund',
      level,
      msg,
      ...data,
    }),
  );
};

Deno.serve(
  withSentry('resolve-dispute-refund', async (req: Request) => {
    try {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        readSupabaseSecretKey()!,
      );
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
        apiVersion: STRIPE_API_VERSION,
        httpClient: Stripe.createFetchHttpClient(),
      });

      // 1. Autenticar usuario
      const authHeader = req.headers.get('Authorization');
      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(
        authHeader?.replace('Bearer ', '') || '',
      );
      if (authError || !user)
        return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
          status: 401,
        });

      const { data: profile } = await supabaseAdmin
        .from('profiles_private')
        .select('role')
        .eq('id', user.id)
        .single();

      // 2. Validar input — solo disputeId
      const { disputeId } = await req.json();
      if (!disputeId)
        return new Response(
          JSON.stringify({ error: 'disputeId es requerido' }),
          {
            status: 422,
          },
        );

      // 3. Leer dispute (determina seller, shipment, status)
      const { data: dispute, error: disputeError } = await supabaseAdmin
        .from('disputes')
        .select(
          `
        seller_id,
        shipment_id,
        order_id,
        status
      `,
        )
        .eq('id', disputeId)
        .single();

      if (disputeError || !dispute)
        return new Response(
          JSON.stringify({ error: 'Disputa no encontrada' }),
          {
            status: 404,
          },
        );

      // 4. Auth: admin O seller de la disputa
      const isAdmin = profile?.role === 'admin';
      const isSeller = dispute.seller_id === user.id;
      if (!isAdmin && !isSeller)
        return new Response(
          JSON.stringify({
            error:
              'Solo administradores o el vendedor de la disputa pueden ejecutar reembolsos',
          }),
          { status: 403 },
        );

      // 5. Validar status de la disputa
      const validStatuses = ['return_delivered', 'waiting_return'];
      if (!validStatuses.includes(dispute.status!))
        return new Response(
          JSON.stringify({
            error: `Estado inválido: ${dispute.status}. Debe ser return_delivered o waiting_return.`,
          }),
          { status: 422 },
        );

      // 6. Resolve the PI ID from the shipment (Connect). A dispute without a
      // shipment, or whose shipment has no payment intent, cannot be refunded;
      // this is refused before any call to Stripe or write to the database.
      const { data: shipment } = dispute.shipment_id
        ? await supabaseAdmin
            .from('shipments')
            .select('status, stripe_payment_intent_id')
            .eq('id', dispute.shipment_id)
            .maybeSingle()
        : { data: null };

      // Only a shipped or delivered shipment can be refunded.
      const blockedReason =
        refundBlockedReason(shipment?.status) ??
        refundIntentBlockedReason(shipment?.stripe_payment_intent_id);
      if (blockedReason || !shipment?.stripe_payment_intent_id)
        return new Response(JSON.stringify({ error: blockedReason }), {
          status: 422,
        });
      const connectStripeIntentId = shipment.stripe_payment_intent_id;

      // =========================================================================
      // FIX CRÍTICO: Calcular monto exacto del shipment (en centavos)
      // Sin esto, Stripe reembolsa el 100% del PaymentIntent → en multi-seller
      // devuelve también el dinero de otros vendedores no disputados.
      // =========================================================================
      let refundAmountCents: number | null = null;

      if (dispute.shipment_id) {
        const { data: orderItems, error: itemsError } = await supabaseAdmin
          .from('order_items')
          .select('price_at_purchase_cents, shipping_amount_cents')
          .eq('shipment_id', dispute.shipment_id);

        if (itemsError || !orderItems || orderItems.length === 0) {
          log(
            'ERROR',
            'Error al consultar items para calcular reembolso parcial',
            {
              error: itemsError?.message,
            },
          );
          return new Response(
            JSON.stringify({
              error:
                'No se pudieron recuperar los artículos del envío para calcular el monto del reembolso.',
            }),
            { status: 500 },
          );
        }

        const refundItems = orderItems as Array<{
          price_at_purchase_cents: number;
          shipping_amount_cents: number | null;
        }>;

        const totalRefundAmountCents = disputeRefundAmountCents(refundItems);

        refundAmountCents = totalRefundAmountCents;
        log('INFO', 'Monto de reembolso calculado', {
          shipmentId: dispute.shipment_id,
          totalRefundAmountCents,
          refundAmountCents,
        });
      }

      // 7. Ejecutar Reembolso en Stripe (idempotente + monto parcial)
      log('INFO', 'Iniciando reembolso en Stripe', {
        disputeId,
        intent: connectStripeIntentId,
        amountCents: refundAmountCents,
      });

      let stripeRefundId: string | null = null;

      try {
        const refundParams: Stripe.RefundCreateParams = {
          payment_intent: connectStripeIntentId,
          reason: 'requested_by_customer' as const,
          metadata: {
            dispute_id: disputeId,
            shipment_id: dispute.shipment_id ?? '',
          },
        };

        // Connect refund: reverse the transfer back from the seller's account
        refundParams.reverse_transfer = true;
        log('INFO', 'Connect refund — reversing transfer', { disputeId });

        if (refundAmountCents !== null) {
          refundParams.amount = refundAmountCents;
        }

        const refund = await stripe.refunds.create(refundParams, {
          idempotencyKey: `refund_dispute_${disputeId}`,
        });
        stripeRefundId = extractRefundId(refund);
      } catch (stripeError: unknown) {
        if (
          typeof stripeError === 'object' &&
          stripeError !== null &&
          'code' in stripeError &&
          (stripeError as { code: string }).code === 'charge_already_refunded'
        ) {
          log('INFO', 'Stripe refund idempotente — ya reembolsado', {
            disputeId,
          });
        } else {
          throw stripeError;
        }
      }

      // 7. Sincronizar DB — shipment-level si existe shipment_id
      let rpcSuccess = false;
      let rpcErrorMsg: string | null = null;

      // Connect refund: reverse_transfer already handled by Stripe. The
      // guarded RPC marks the shipment refunded and resolves the dispute.
      log('INFO', 'Connect refund — recording in database', {
        disputeId,
        shipmentId: dispute.shipment_id,
        stripeRefundId,
      });

      const { data: recordData, error: recordError } = await supabaseAdmin.rpc(
        'fn_record_dispute_refund',
        {
          p_dispute_id: disputeId,
          p_stripe_refund_id: stripeRefundId,
        },
      );

      if (recordError) {
        rpcErrorMsg = recordError.message;
      } else {
        rpcSuccess = recordData?.[0]?.success ?? false;
        rpcErrorMsg = recordData?.[0]?.error_code ?? null;
      }

      if (!rpcSuccess) {
        log('CRITICAL', 'REEMBOLSO STRIPE HECHO PERO FALLO DB', {
          disputeId,
          error: rpcErrorMsg,
        });
        return new Response(
          JSON.stringify({
            error:
              'Dinero devuelto en Stripe, pero falló la actualización en Selene. Contacta a soporte.',
            dbError: rpcErrorMsg,
          }),
          { status: 500 },
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido';
      log('ERROR', 'Fallo en resolución de reembolso', { error: message });
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
      });
    }
  }),
);
