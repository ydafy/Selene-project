import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
      function: 'track-returns',
      level,
      msg,
      ...data,
    }),
  );
};

const BATCH_SIZE = 50;

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    log('INFO', 'Iniciando rastreo de retornos');

    // 1. Obtener disputas en fase de retorno (priorizando las menos rastreadas)
    const { data: disputes, error: fetchError } = await supabaseAdmin
      .from('disputes')
      .select('id, return_tracking_number, status')
      .in('status', ['waiting_return', 'return_shipped'])
      .not('return_tracking_number', 'is', null)
      .order('return_last_tracked_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;
    if (!disputes || disputes.length === 0) {
      log('INFO', 'No hay retornos activos para rastrear');
      return new Response(JSON.stringify({ message: 'No returns to track' }), {
        status: 200,
      });
    }

    // 2. Configuración API Envia
    const mode = Deno.env.get('ENVIA_MODE') || 'sandbox';
    const apiKey =
      mode === 'sandbox'
        ? Deno.env.get('ENVIA_API_KEY_SANDBOX')
        : Deno.env.get('ENVIA_API_KEY_PROD');
    const apiUrl =
      mode === 'sandbox'
        ? 'https://api-test.envia.com'
        : 'https://api.envia.com';

    const trackingNumbers = [
      ...new Set(disputes.map((d) => d.return_tracking_number)),
    ];

    // 3. Consulta masiva a Envia.com
    const response = await fetch(`${apiUrl}/ship/generaltrack/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ trackingNumbers }),
    });

    const resData = await response.json();
    if (!response.ok || resData.meta === 'error') {
      throw new Error(`Envia API Error: ${resData.message || 'Unknown'}`);
    }

    let deliveredCount = 0;
    const processedIds: string[] = [];

    // 4. Procesar resultados
    for (const trackInfo of resData.data) {
      const matchingDisputes = disputes.filter(
        (d) => d.return_tracking_number === trackInfo.trackingNumber,
      );
      if (matchingDisputes.length === 0) continue;

      for (const dispute of matchingDisputes) {
        // Acumular ID para bulk update de return_last_tracked_at (evita N+1)
        processedIds.push(dispute.id);

        // Si el estado es entregado, disparamos la RPC
        if (trackInfo.status?.toLowerCase() === 'delivered') {
          log('INFO', `Retorno entregado detectado`, { disputeId: dispute.id });

          const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
            'fn_mark_return_delivered',
            {
              p_dispute_id: dispute.id,
            },
          );

          if (rpcError || (rpcData && !rpcData[0]?.success)) {
            log('ERROR', `Fallo al ejecutar fn_mark_return_delivered`, {
              disputeId: dispute.id,
              error: rpcError?.message || rpcData?.[0]?.error_message,
            });
          } else {
            deliveredCount++;
          }
        }
      }
    }

    // 5. Bulk update: un solo viaje a DB para actualizar return_last_tracked_at
    if (processedIds.length > 0) {
      await supabaseAdmin
        .from('disputes')
        .update({ return_last_tracked_at: new Date().toISOString() })
        .in('id', processedIds);
    }

    log('INFO', 'Rastreo de retornos finalizado', {
      total: disputes.length,
      delivered: deliveredCount,
    });

    return new Response(
      JSON.stringify({ processed: disputes.length, delivered: deliveredCount }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error desconocido';
    log('ERROR', 'Fallo crítico en track-returns', { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
});
