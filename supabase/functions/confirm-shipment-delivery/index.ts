import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

import {
  ApiError,
  buildConfirmationDiagnostic,
  mapConfirmationRpcResult,
  parseConfirmationRequestBody,
  resolveBuyerConfirmationPlan,
} from './confirm-shipment-delivery.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const confirmationRequestSchema = z
  .object({
    orderId: z.string().uuid(),
    shipmentId: z.string().uuid(),
    idempotencyKey: z.string().min(1),
  })
  .strict()
  .refine(
    (request) =>
      request.idempotencyKey === `confirm_shipment_${request.shipmentId}`,
    { path: ['idempotencyKey'], message: 'Invalid idempotency key' },
  );

const log = (
  level: 'INFO' | 'ERROR',
  msg: string,
  data: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'confirm-shipment-delivery',
      level,
      msg,
      ...data,
    }),
  );
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let request:
    | { orderId: string; shipmentId: string; idempotencyKey: string }
    | undefined;

  try {
    if (req.method !== 'POST') {
      throw new ApiError(400, 'INVALID_REQUEST');
    }

    const body = await req.json().catch(() => null);
    const parsed = confirmationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, 'INVALID_REQUEST');
    }
    request = parseConfirmationRequestBody(parsed.data);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new ApiError(401, 'AUTH_REQUIRED');
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      throw new ApiError(401, 'AUTH_REQUIRED');
    }

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('system_settings')
      .select('is_maintenance')
      .eq('id', 1)
      .single();
    if (settingsError || !settings) {
      throw new ApiError(500, 'INTERNAL_ERROR');
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, buyer_id')
      .eq('id', request.orderId)
      .maybeSingle();
    if (orderError || !order) {
      throw new ApiError(404, 'SHIPMENT_NOT_FOUND');
    }

    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from('shipments')
      .select('id, order_id, status')
      .eq('id', request.shipmentId)
      .eq('order_id', request.orderId)
      .maybeSingle();
    if (shipmentError || !shipment) {
      throw new ApiError(404, 'SHIPMENT_NOT_FOUND');
    }

    const { data: activeDispute, error: disputeError } = await supabaseAdmin
      .from('disputes')
      .select('id')
      .eq('shipment_id', request.shipmentId)
      .not('status', 'in', '(resolved,rejected)')
      .maybeSingle();
    if (disputeError) {
      throw new ApiError(500, 'INTERNAL_ERROR');
    }

    const rpcInput = resolveBuyerConfirmationPlan({
      isMaintenance: settings.is_maintenance,
      actorId: user.id,
      order,
      shipment,
      hasActiveDispute: Boolean(activeDispute),
    });

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'fn_confirm_shipment_delivery',
      rpcInput,
    );
    if (rpcError) {
      throw new ApiError(500, 'INTERNAL_ERROR');
    }

    const result = mapConfirmationRpcResult(
      Array.isArray(rpcData) ? rpcData[0] : rpcData,
      request.shipmentId,
    );
    log(
      'INFO',
      'Shipment confirmation completed',
      buildConfirmationDiagnostic({
        shipmentId: request.shipmentId,
        idempotencyKey: request.idempotencyKey,
        result: 'success',
        code: result.idempotent ? 'IDEMPOTENT_SUCCESS' : 'COMPLETED',
      }),
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const apiError =
      error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR');

    log(
      'ERROR',
      'Shipment confirmation failed',
      request
        ? buildConfirmationDiagnostic({
            shipmentId: request.shipmentId,
            idempotencyKey: request.idempotencyKey,
            result: 'failure',
            code: apiError.code,
          })
        : { source: 'buyer', result: 'failure', code: apiError.code },
    );

    return new Response(
      JSON.stringify({ success: false, error: apiError.code }),
      {
        status: apiError.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
