import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import { normalizeAccountStatus } from '../_shared/connect-status.ts';
import { reconcileConnectPayoutEvent } from './connect-payout-reconciliation.ts';
import {
  SINGLE_MODAL_FLOW,
  buildSettlementOutcome,
  buildStripeFeeReconciliationPlan,
  resolvePaymentIntentSucceededAction,
  type SingleModalSettlementInput,
} from './single-modal-settlement.ts';

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
  apiVersion: '2026-04-22.dahlia',
  httpClient: Stripe.createFetchHttpClient(),
});

const APP_NAME = 'selene';
const RECOVERABLE_MISSING_PAYOUT_ID_STATUSES = [
  'pending_reconciliation',
  'reconciliation_needed',
];

const extractStripeChargeId = (intent: Stripe.PaymentIntent): string | null => {
  const latestCharge = intent.latest_charge;
  if (typeof latestCharge === 'string' && latestCharge.length > 0) {
    return latestCharge;
  }

  if (
    latestCharge &&
    typeof latestCharge === 'object' &&
    'id' in latestCharge &&
    typeof latestCharge.id === 'string' &&
    latestCharge.id.length > 0
  ) {
    return latestCharge.id;
  }

  const firstCharge = intent.charges?.data?.[0];
  if (firstCharge && typeof firstCharge.id === 'string' && firstCharge.id.length > 0) {
    return firstCharge.id;
  }

  return null;
};

const buildSingleModalAllocationPayload = (
  input: SingleModalSettlementInput,
) => ({
  buyer_id: input.buyerId,
  address_id: input.addressId,
  order_id: input.orderId,
  order_group_id: input.orderId,
  total_amount: input.totalsCents.buyerTotal / 100,
  rows: input.rows.map((row) => ({
    seller_id: row.sellerId,
    shipment_id: row.shipmentId,
    product_ids: row.productIds,
    gross_cents: row.grossCents,
    commission_cents: row.commissionCents,
    shipping_cents: row.shippingCents,
    seguro_cents: row.seguroCents,
    net_cents: row.netCents,
  })),
});

type ConnectPayoutRunRow = {
  id: string;
  status: string;
  stripe_payout_id: string | null;
};

async function findConnectPayoutRun(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: { payoutId: string; metadataRunId?: string | null },
): Promise<ConnectPayoutRunRow | null> {
  const { data: payoutRun, error: payoutRunError } = await supabaseAdmin
    .from('connect_payout_runs')
    .select('id, status, stripe_payout_id')
    .eq('stripe_payout_id', input.payoutId)
    .maybeSingle();
  if (payoutRunError)
    throw new Error(`PAYOUT_RUN_LOOKUP_FAILED: ${payoutRunError.message}`);
  if (payoutRun) return payoutRun as ConnectPayoutRunRow;

  if (input.metadataRunId) {
    const { data, error } = await supabaseAdmin
      .from('connect_payout_runs')
      .select('id, status, stripe_payout_id')
      .eq('id', input.metadataRunId)
      .maybeSingle();
    if (error) throw new Error(`PAYOUT_RUN_LOOKUP_FAILED: ${error.message}`);
    if (data) {
      const run = data as ConnectPayoutRunRow;
      if (
        run.stripe_payout_id ||
        RECOVERABLE_MISSING_PAYOUT_ID_STATUSES.includes(run.status)
      ) {
        return run;
      }
    }
  }

  return null;
}

async function attachConnectPayoutRunPayoutId(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: { runId: string; stripePayoutId: string },
) {
  const { data, error } = await supabaseAdmin
    .from('connect_payout_runs')
    .update({
      stripe_payout_id: input.stripePayoutId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.runId)
    .is('stripe_payout_id', null)
    .in('status', RECOVERABLE_MISSING_PAYOUT_ID_STATUSES)
    .select('id');
  if (error) throw new Error(`PAYOUT_RUN_ATTACH_FAILED: ${error.message}`);
  if (((data as Array<{ id: string }> | null) ?? []).length !== 1) {
    throw new Error('PAYOUT_RUN_ATTACH_CONFLICT');
  }
}

async function markConnectPayoutRunStatus(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: {
    runId: string;
    status: 'paid' | 'failed' | 'canceled';
    occurredAt: string;
    failureReason?: string | null;
  },
) {
  const update = {
    status: input.status,
    updated_at: input.occurredAt,
    ...(input.status === 'paid' ? { paid_at: input.occurredAt } : {}),
    ...(input.status === 'failed' || input.status === 'canceled'
      ? {
          failed_at: input.occurredAt,
          failure_reason: input.failureReason ?? input.status,
        }
      : {}),
  };

  const { error } = await supabaseAdmin
    .from('connect_payout_runs')
    .update(update)
    .eq('id', input.runId);
  if (error) throw new Error(`PAYOUT_RUN_UPDATE_FAILED: ${error.message}`);
}

async function markConnectPayoutRunShipmentsStatus(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: { runId: string; status: 'paid' | 'failed' | 'canceled' },
) {
  const { error } = await supabaseAdmin
    .from('connect_payout_run_shipments')
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq('run_id', input.runId);
  if (error) throw new Error(`PAYOUT_MAPPING_UPDATE_FAILED: ${error.message}`);
}

async function listConnectPayoutRunShipmentIds(
  supabaseAdmin: ReturnType<typeof createClient>,
  runId: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('connect_payout_run_shipments')
    .select('shipment_id')
    .eq('run_id', runId);
  if (error) throw new Error(`PAYOUT_MAPPING_LOOKUP_FAILED: ${error.message}`);

  return ((data as Array<{ shipment_id: string | null }> | null) ?? [])
    .map((row) => row.shipment_id)
    .filter((shipmentId): shipmentId is string => Boolean(shipmentId));
}

async function markConnectShipmentsReleased(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: { shipmentIds: string[]; stripePayoutId: string },
) {
  if (input.shipmentIds.length === 0) {
    throw new Error('PAYOUT_RUN_HAS_NO_SHIPMENTS');
  }

  const { data: shipments, error: loadError } = await supabaseAdmin
    .from('shipments')
    .select('id, stripe_payout_id')
    .in('id', input.shipmentIds);
  if (loadError)
    throw new Error(`SHIPMENT_LOOKUP_FAILED: ${loadError.message}`);

  const rows =
    (shipments as Array<{
      id: string;
      stripe_payout_id: string | null;
    }> | null) ?? [];
  if (rows.length !== input.shipmentIds.length) {
    throw new Error('PAYOUT_SHIPMENT_LOOKUP_INCOMPLETE');
  }

  const conflicting = rows.find(
    (row) =>
      row.stripe_payout_id !== null &&
      row.stripe_payout_id !== input.stripePayoutId,
  );
  if (conflicting) {
    throw new Error(`SHIPMENT_ALREADY_RELEASED:${conflicting.id}`);
  }

  const pendingIds = rows
    .filter((row) => row.stripe_payout_id === null)
    .map((row) => row.id);
  if (pendingIds.length === 0) return;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('shipments')
    .update({
      stripe_payout_id: input.stripePayoutId,
      updated_at: new Date().toISOString(),
    })
    .in('id', pendingIds)
    .is('stripe_payout_id', null)
    .select('id');
  if (updateError) {
    throw new Error(`SHIPMENT_RELEASE_UPDATE_FAILED: ${updateError.message}`);
  }

  if (
    ((updated as Array<{ id: string }> | null) ?? []).length !==
    pendingIds.length
  ) {
    throw new Error('SHIPMENT_RELEASE_PARTIAL_UPDATE');
  }
}

async function markConnectPayoutRunReconciliationNeeded(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: { runId: string; failureReason: string },
) {
  const { error } = await supabaseAdmin
    .from('connect_payout_runs')
    .update({
      status: 'reconciliation_needed',
      failure_reason: input.failureReason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.runId);
  if (error) {
    throw new Error(`PAYOUT_RECONCILIATION_MARK_FAILED: ${error.message}`);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('No signature', { status: 400 });

  let rawBody = '';

  try {
    rawBody = await req.text();
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        Deno.env.get('STRIPE_WEBHOOK_SECRET') || '',
      );
    } catch {
      // Fallback: Si falla, intentar descifrar con el secreto de Connect
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET') || '',
      );
    }

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

      const action = resolvePaymentIntentSucceededAction({
        metadata: intent.metadata as Record<string, string>,
        amount: intent.amount,
      });

      if (action.kind === 'single_modal') {
        const chargeId = extractStripeChargeId(intent);
        if (!chargeId) {
          throw new Error('MISSING_STRIPE_CHARGE_ID');
        }

        log('INFO', 'Procesando single-modal settlement', {
          intentId: intent.id,
          flow: SINGLE_MODAL_FLOW,
          transferGroup: action.payload.transferGroup,
          chargeId,
        });

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_create_shipments_from_single_payment',
          {
            p_stripe_payment_intent_id: intent.id,
            p_stripe_charge_id: chargeId,
            p_amount_received: intent.amount,
            p_transfer_group: action.payload.transferGroup,
            p_allocation: buildSingleModalAllocationPayload(action.payload),
          },
        );

        const outcome = buildSettlementOutcome({
          rpcResult: rpcData,
          rpcError,
        });

        if (outcome.kind === 'ok') {
          const { data: orderRow, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('actual_stripe_fee_cents, stripe_fee_reconciled_at')
            .eq('id', action.payload.orderId)
            .single();

          if (orderError || !orderRow) {
            throw new Error(
              `ORDER_STRIPE_FEE_LOOKUP_FAILED: ${orderError?.message || 'not_found'}`,
            );
          }

          const charge = (await stripe.charges.retrieve(chargeId, {
            expand: ['balance_transaction'],
          })) as Stripe.Charge;

          const feePlan = buildStripeFeeReconciliationPlan({
            existingActualStripeFeeCents:
              orderRow.actual_stripe_fee_cents ?? null,
            charge: charge as unknown as {
              id: string;
              balance_transaction?:
                | string
                | { fee?: number | null }
                | null;
            },
            reconciledAt: new Date().toISOString(),
          });

          if (feePlan.kind === 'missing_balance_transaction') {
            throw new Error('MISSING_BALANCE_TRANSACTION_FEE');
          }

          if (feePlan.kind === 'ready') {
            const { data: updatedRows, error: updateError } = await supabaseAdmin
              .from('orders')
              .update({
                actual_stripe_fee_cents: feePlan.actualStripeFeeCents,
                stripe_fee_reconciled_at: feePlan.stripeFeeReconciledAt,
                updated_at: feePlan.stripeFeeReconciledAt,
              })
              .eq('id', action.payload.orderId)
              .is('actual_stripe_fee_cents', null)
              .select('id');

            if (updateError) {
              throw new Error(`ORDER_STRIPE_FEE_UPDATE_FAILED: ${updateError.message}`);
            }

            if (((updatedRows as Array<{ id: string }> | null) ?? []).length !== 1) {
              const { data: refreshedOrder, error: refreshError } = await supabaseAdmin
                .from('orders')
                .select('actual_stripe_fee_cents')
                .eq('id', action.payload.orderId)
                .single();

              if (refreshError) {
                throw new Error(
                  `ORDER_STRIPE_FEE_REFRESH_FAILED: ${refreshError.message}`,
                );
              }

              if (refreshedOrder?.actual_stripe_fee_cents == null) {
                throw new Error('ORDER_STRIPE_FEE_UPDATE_CONFLICT');
              }
            }
          }

          return new Response(JSON.stringify(outcome.body), { status: 200 });
        }

        if (outcome.kind === 'recovered') {
          log('WARN', 'Single-modal settlement recovered for ops retry', {
            intentId: intent.id,
            reason: outcome.reason,
          });
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
          });
        }

        if (outcome.kind === 'fatal_error') {
          log('ERROR', 'Single-modal settlement fatal_error', {
            intentId: intent.id,
            message: outcome.message,
          });
        }

        throw new Error(outcome.message);
      }

      // Connect path: PaymentIntent has seller_id metadata → per-seller PI
      if (action.kind === 'connect_per_seller' || intent.metadata.seller_id) {
        log('INFO', 'Procesando Connect PaymentIntent', {
          intentId: intent.id,
          seller_id: intent.metadata.seller_id,
          order_group_id: intent.metadata.order_group_id,
        });

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_create_shipment_from_payment',
          {
            p_stripe_payment_intent_id: intent.id,
            p_amount_received: intent.amount,
            p_metadata: intent.metadata,
          },
        );

        if (rpcError) {
          log('ERROR', 'Connect shipment creation failed', {
            error: rpcError.message,
            intentId: intent.id,
          });
          throw new Error(
            `Connect shipment creation failed: ${rpcError.message}`,
          );
        }

        log('INFO', 'Connect shipment created', {
          intentId: intent.id,
          result: rpcData,
        });

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      }

      // Legacy path: single PaymentIntent for entire order (pre-Connect)
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
          dbProducts.reduce(
            (sum: number, p: { price: number }) => sum + Number(p.price),
            0,
          ) * 100,
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

    if (
      event.type === 'payout.paid' ||
      event.type === 'payout.failed' ||
      event.type === 'payout.canceled'
    ) {
      const payout = event.data.object as Stripe.Payout;
      const occurredAt = new Date(
        (payout.created ?? event.created) * 1000,
      ).toISOString();
      const result = await reconcileConnectPayoutEvent(
        {
          eventType: event.type,
          payoutId: payout.id,
          metadataRunId: payout.metadata?.run_id ?? null,
          occurredAt,
          failureReason: payout.failure_message ?? payout.failure_code ?? null,
        },
        {
          findRunForPayout: (input) =>
            findConnectPayoutRun(supabaseAdmin, input),
          listRunShipmentIds: (runId) =>
            listConnectPayoutRunShipmentIds(supabaseAdmin, runId),
          markRunStatus: (input) =>
            markConnectPayoutRunStatus(supabaseAdmin, input),
          markRunShipmentsStatus: (input) =>
            markConnectPayoutRunShipmentsStatus(supabaseAdmin, input),
          markShipmentsReleased: (input) =>
            markConnectShipmentsReleased(supabaseAdmin, input),
          markRunReconciliationNeeded: (input) =>
            markConnectPayoutRunReconciliationNeeded(supabaseAdmin, input),
          attachRunPayoutId: (input) =>
            attachConnectPayoutRunPayoutId(supabaseAdmin, input),
        },
      );

      log('INFO', 'Connect payout reconciliation processed', {
        payoutId: payout.id,
        eventType: event.type,
        result: result.status,
        ...(result.status !== 'ignored' ? { runId: result.runId } : {}),
      });
    }

    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      const normalized = normalizeAccountStatus(account);
      const refreshedAt = new Date().toISOString();

      log('INFO', 'account.updated received', {
        accountId: account.id,
        chargesEnabled: normalized.chargesEnabled,
        payoutsEnabled: normalized.payoutsEnabled,
        nextStatus: normalized.status,
      });

      const { error: updErr } = await supabaseAdmin
        .from('profiles_private')
        .update({
          stripe_onboarding_status: normalized.status,
          stripe_onboarding_refreshed_at: refreshedAt,
          updated_at: refreshedAt,
        })
        .eq('stripe_account_id', account.id);
      if (updErr) {
        log('ERROR', 'Failed to update onboarding status', {
          error: updErr.message,
        });
        throw new Error(`PROFILE_UPDATE_FAILED: ${updErr.message}`);
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log('ERROR', 'Fallo crítico en Webhook', { error: message });

    try {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      let payloadObj: Record<string, unknown> = {};
      try {
        payloadObj = JSON.parse(rawBody || '{}');
      } catch {
        // Silencioso por seguridad: si falla el parseo, cae en el fallback de objeto vacío.
      }

      await supabaseAdmin.from('webhook_dlq').insert({
        event_type: (payloadObj.type as string) || 'unknown_parse_error',
        payload: payloadObj,
        error_message: message,
      });
      log('INFO', 'Evento fallido guardado en DLQ exitosamente');
    } catch (dlqErr: unknown) {
      log('CRITICAL', 'Fallo catastrófico: No se pudo guardar en DLQ', {
        error: String(dlqErr),
      });
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
});
