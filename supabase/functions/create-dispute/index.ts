import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  ApiError,
  mapDisputeErrorCode,
  parseCreateDisputeRequestBody,
} from './create-dispute.ts';
import { withSentry } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'create-dispute',
      level,
      msg,
      ...data,
    }),
  );
};

serve(withSentry('create-dispute', async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { orderId, shipmentId, reason, description, evidence } =
      parseCreateDisputeRequestBody(body);

    log('INFO', 'Iniciando creación de disputa', {
      orderId,
      shipmentId,
      reason,
    });

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
    if (authError || !user) throw new ApiError(401, 'AUTH_REQUIRED');

    // 2. Abrir la disputa en una sola transacción que bloquea el envío
    const { data, error: rpcError } = await supabaseAdmin.rpc(
      'fn_open_shipment_dispute',
      {
        p_buyer_id: user.id,
        p_order_id: orderId,
        p_shipment_id: shipmentId,
        p_reason: reason,
        p_description: description,
        p_evidence: evidence,
      },
    );

    if (rpcError) {
      throw new ApiError(500, `Error al crear disputa: ${rpcError.message}`);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new ApiError(500, 'Error al crear disputa: sin respuesta');
    if (result.error_code) {
      log('WARN', 'Disputa rechazada', {
        orderId,
        shipmentId,
        errorCode: result.error_code,
      });
      throw mapDisputeErrorCode(result.error_code);
    }

    const dispute = { id: result.dispute_id as string };

    log('INFO', 'Disputa creada exitosamente', {
      disputeId: dispute.id,
      orderId,
      shipmentId,
    });

    return new Response(
      JSON.stringify({ success: true, disputeId: dispute.id }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'Fallo al crear disputa', { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
