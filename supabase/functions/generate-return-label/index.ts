/**
 * @file supabase/functions/generate-return-label/index.ts
 *
 * Generates a return shipping label via Envia.com for dispute returns.
 *
 * Flow: Buyer wins dispute → Seller pays return shipping (create-return-intent)
 * → Buyer generates the return label (this function) → Buyer ships product back.
 *
 * Origin = Buyer (shipping_address from orders)
 * Destination = Seller (origin_address from the disputed shipment)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'generate-return-label',
      level,
      msg,
      ...data,
    }),
  );
};

const RequestSchema = z.object({
  disputeId: z.string().uuid('ID de disputa inválido'),
});

const cleanPhone = (p: string) =>
  String(p || '5500000000')
    .replace(/\D/g, '')
    .slice(-10);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { disputeId } = RequestSchema.parse(body);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. Autenticación
    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );
    if (authError || !user) throw new ApiError(401, 'No autorizado');

    // 2. Fetch dispute + order shipping address + shipment origin address
    const { data: dispute, error: disputeError } = await supabaseAdmin
      .from('disputes')
      .select(
        'id, seller_id, status, order_id, buyer_id, shipment_id, return_payout_status, return_tracking_number',
      )
      .eq('id', disputeId)
      .single();

    if (disputeError || !dispute)
      throw new ApiError(404, 'Disputa no encontrada');

    if (dispute.buyer_id !== user.id)
      throw new ApiError(
        403,
        'Solo el comprador puede generar la guía de retorno',
      );

    if (dispute.status !== 'waiting_return')
      throw new ApiError(422, 'La disputa no está en fase de retorno');

    if (dispute.return_payout_status !== 'paid')
      throw new ApiError(
        422,
        'El vendedor aún no ha pagado la guía de retorno',
      );

    if (dispute.return_tracking_number)
      throw new ApiError(409, 'Ya existe una guía de retorno generada');

    // 3. Fetch origin (buyer's shipping address) from the order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, shipping_address')
      .eq('id', dispute.order_id)
      .single();

    if (orderError || !order?.shipping_address)
      throw new ApiError(404, 'Dirección de envío del comprador no encontrada');

    const buyerAddress = order.shipping_address as {
      full_name?: string;
      phone?: string;
      street_line1: string;
      district?: string;
      city: string;
      state?: string;
      state_code?: string;
      zip_code: string;
    };

    // 4. Fetch destination (seller's origin) from the disputed shipment
    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from('shipments')
      .select('id, seller_id, origin_address')
      .eq('id', dispute.shipment_id)
      .single();

    if (shipmentError || !shipment?.origin_address)
      throw new ApiError(404, 'Dirección de origen del vendedor no encontrada');

    const sellerOrigin = shipment.origin_address as {
      full_name?: string;
      phone?: string;
      street_line1: string;
      district?: string;
      city: string;
      state?: string;
      state_code?: string;
      zip_code: string;
    };

    // 5. Envia.com configuration
    const mode = Deno.env.get('ENVIA_MODE') || 'sandbox';
    const apiKey =
      mode === 'sandbox'
        ? Deno.env.get('ENVIA_API_KEY_SANDBOX')
        : Deno.env.get('ENVIA_API_KEY_PROD');
    const apiUrl =
      mode === 'sandbox'
        ? Deno.env.get('ENVIA_API_URL_SANDBOX')
        : Deno.env.get('ENVIA_API_URL_PROD');

    if (!apiKey || !apiUrl)
      throw new ApiError(500, 'Configuración de Envia.com no encontrada');

    // 6. Build Envia payload
    // Origin = Buyer (they're shipping the product back)
    // Destination = Seller (receiving the returned product)
    const payload = {
      origin: {
        name: buyerAddress.full_name || 'Comprador Selene',
        phone: cleanPhone(buyerAddress.phone || ''),
        street: buyerAddress.street_line1,
        number: 'SN',
        district: buyerAddress.district || 'Centro',
        city: buyerAddress.city,
        state: (buyerAddress.state_code || buyerAddress.state || 'DF')
          .substring(0, 2)
          .toUpperCase(),
        country: 'MX',
        postalCode: buyerAddress.zip_code,
      },
      destination: {
        name: sellerOrigin.full_name || 'Vendedor Selene',
        phone: cleanPhone(sellerOrigin.phone || ''),
        street: sellerOrigin.street_line1,
        number: 'SN',
        district: sellerOrigin.district || 'Centro',
        city: sellerOrigin.city,
        state: (sellerOrigin.state_code || sellerOrigin.state || 'DF')
          .substring(0, 2)
          .toUpperCase(),
        country: 'MX',
        postalCode: sellerOrigin.zip_code,
      },
      packages: [
        {
          type: 'box',
          content: 'Hardware — Devolución',
          amount: 1,
          declaredValue: 0,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: 3, // 3kg — generic safe weight for PC hardware
          dimensions: { length: 30, width: 30, height: 15 },
        },
      ],
      shipment: { carrier: 'paquetexpress', service: 'ground', type: 1 },
      settings: { currency: 'MXN', printFormat: 'PDF', printSize: 'STOCK_4X6' },
    };

    // 7. Call Envia API
    log('INFO', 'Solicitando guía de retorno a Envia', {
      disputeId,
      orderId: dispute.order_id,
    });

    const response = await fetch(
      `${apiUrl}/ship/generate/`.replace(/([^:]\/)\/+/g, '$1'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
    );

    const resData = await response.json();

    if (!response.ok || resData.meta === 'error' || resData.code >= 400) {
      log('ERROR', 'Error de Envia.com', {
        disputeId,
        enviaError: resData,
      });
      throw new ApiError(
        422,
        resData.description || resData.message || 'Error de paquetería',
      );
    }

    // 8. Extract tracking + label
    const trackingNumber = resData.data[0].trackingNumber;
    const labelUrl = resData.data[0].label;

    log('INFO', 'Guía de retorno generada', {
      disputeId,
      trackingNumber,
    });

    // 9. Persist: update dispute with tracking + label + status
    const { error: updateError } = await supabaseAdmin
      .from('disputes')
      .update({
        return_tracking_number: trackingNumber,
        return_label_url: labelUrl,
        status: 'return_shipped',
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    if (updateError) {
      log('ERROR', '[CRITICAL] Guía de retorno generada pero falló DB', {
        disputeId,
        trackingNumber,
        dbError: updateError.message,
      });
      return new Response(
        JSON.stringify({
          success: true,
          trackingNumber,
          labelUrl,
          warning:
            'La guía se generó pero no se pudo actualizar en Selene. Contactá a soporte.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        trackingNumber,
        labelUrl,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'Fallo al generar guía de retorno', { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
