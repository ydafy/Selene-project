/**
 * @file supabase/functions/create-payment-intent/index.ts
 * Versión 4.0: Producción Final.
 * Arquitectura híbrida, manejo de errores exhaustivo e integridad financiera.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

const APP_NAME = 'selene';
const STRIPE_API_VERSION = '2025-12-15.clover';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RequestSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1),
  addressId: z.string().uuid(),
  idempotencyKey: z.string().optional(),
});

/**
 * Logger estructurado para auditoría en Supabase Logs
 */
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
      function: 'create-payment-intent',
      ...meta,
    }),
  );
};

serve(async (req) => {
  // 1. MANEJO DE CORS PRE-FLIGHT
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    log('info', '--- Starting Payment Intent Creation ---');

    // 2. VALIDACIÓN DE SECRETOS
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!stripeSecret || !serviceRoleKey)
      throw new Error('MISSING_SERVER_CONFIG');

    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 3. INICIALIZAR CLIENTES (Arquitectura Híbrida)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('AUTH_REQUIRED');

    // Cliente para el usuario (Respeta RLS en la reserva)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Cliente para el sistema (Acceso a system_settings)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    );

    // 4. AUTENTICACIÓN
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    // 5. OBTENER CONFIGURACIÓN DINÁMICA
    const { data: sysSettings, error: configError } = await supabaseAdmin
      .from('system_settings')
      .select('service_fee_pct, service_fee_fixed_cents, isr_withholding_pct, iva_withholding_pct')
      .eq('id', 1)
      .single();

    if (configError || !sysSettings)
      throw new Error('SYSTEM_SETTINGS_NOT_FOUND');

    // 6. VALIDACIÓN DE INPUT (Zod)
    const body = await req.json();
    const result = RequestSchema.safeParse(body);
    if (!result.success) {
      log('error', 'Validation failed', { errors: result.error.format() });
      throw new Error('INVALID_INPUT');
    }
    const { productIds, addressId, idempotencyKey } = result.data;

    // 7. RESERVA ATÓMICA DE STOCK (Vía Client - Respeta RLS)
    const { data: reserveData, error: rpcError } = await supabaseClient.rpc(
      'fn_reserve_products',
      {
        p_product_ids: productIds,
        p_buyer_id: user.id,
      },
    );

    const reservation = reserveData?.[0];
    if (rpcError || !reservation?.success) {
      log('warn', 'Inventory lock failed', {
        error: rpcError?.message || reservation?.error_message,
      });
      throw new Error(reservation?.error_message || 'STOCK_UNAVAILABLE');
    }

    // 8. OBTENER BREAKDOWN POR SELLER (Multi-seller support)
    const { data: sellerProducts, error: productsError } = await supabaseAdmin
      .from('products')
      .select('seller_id, shipping_cost')
      .in('id', productIds);

    if (productsError || !sellerProducts || sellerProducts.length !== productIds.length) {
      log('error', 'Products fetch failed', {
        error: productsError?.message,
        count: sellerProducts?.length,
        expected: productIds.length,
      });
      throw new Error('PRODUCTS_NOT_FOUND');
    }

    const uniqueSellerIds = [...new Set(sellerProducts.map((p) => p.seller_id))];
    const sellerShipping: Record<string, number> = {};

    for (const product of sellerProducts) {
      const cost = product.shipping_cost ?? 0;
      sellerShipping[product.seller_id] = (sellerShipping[product.seller_id] ?? 0) + cost;
    }

    // 9. CÁLCULOS FINANCIEROS DINÁMICOS
    const subtotalFromDB = Number(reservation.total_price);
    const subtotalCents = Math.round(subtotalFromDB * 100);
    const serviceFeeCents =
      Math.round(subtotalCents * sysSettings.service_fee_pct) +
      sysSettings.service_fee_fixed_cents;
    const totalCents = subtotalCents + serviceFeeCents;

    const isrPct = sysSettings.isr_withholding_pct ?? 0.01;
    const ivaPct = sysSettings.iva_withholding_pct ?? 0.08;
    const satIsrWithholding = subtotalFromDB * isrPct;
    const satIvaWithholding = subtotalFromDB * ivaPct;
    const satTotalWithholding = satIsrWithholding + satIvaWithholding;

    // 10. IDENTIDAD STRIPE
    const { data: profile } = await supabaseClient
      .from('profiles_private')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    const customerId = profile?.stripe_customer_id;
    if (!customerId) throw new Error('STRIPE_CUSTOMER_NOT_FOUND');

    // 11. LLAVES Y PAYMENT INTENT
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: STRIPE_API_VERSION },
    );

    const serviceFeeTotal = serviceFeeCents / 100;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: 'mxn',
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        metadata: {
          buyer_id: user.id,
          product_ids: JSON.stringify(productIds),
          address_id: addressId,
          app_name: APP_NAME,
          subtotal: subtotalFromDB.toString(),
          service_fee: serviceFeeTotal.toString(), // <--- MEJORA DE AUDITORÍA
          total_expected: (totalCents / 100).toString(), // <--- MEJORA DE AUDITORÍA
          seller_ids: JSON.stringify(uniqueSellerIds),
          seller_shipping: JSON.stringify(sellerShipping),
          sat_isr_withholding: satIsrWithholding.toString(),
          sat_iva_withholding: satIvaWithholding.toString(),
          sat_total_withholding: satTotalWithholding.toString(),
        },
      },
      {
        idempotencyKey: idempotencyKey || crypto.randomUUID(),
      },
    );

    log('info', 'PaymentIntent created', { intentId: paymentIntent.id });

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        ephemeralKey: ephemeralKey.secret,
        customer: customerId,
        amount: totalCents / 100,
        subtotal: subtotalFromDB,
        serviceFee: serviceFeeCents / 100,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', 'Request failed', { message });

    // Manejo específico de errores de Stripe
    if (message.toLowerCase().includes('stripe')) {
      return new Response(JSON.stringify({ error: 'PAYMENT_PROVIDER_ERROR' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mapeo de códigos de estado
    const statusMap: Record<string, number> = {
      AUTH_REQUIRED: 401,
      INVALID_INPUT: 422,
      STOCK_UNAVAILABLE: 409,
      SYSTEM_SETTINGS_NOT_FOUND: 500,
      STRIPE_CUSTOMER_NOT_FOUND: 400,
      MISSING_SERVER_CONFIG: 500,
      PRODUCTS_NOT_FOUND: 500,
    };

    const status = statusMap[message] || 400;

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
