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
      function: 'track-shipments',
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

    log('INFO', 'Iniciando rastreo de paquetes');

    // 1. Obtener shipments activos (priorizando los menos rastreados recientemente)
    const { data: shipments, error: fetchError } = await supabaseAdmin
      .from('shipments')
      .select('id, order_id, tracking_number, status')
      .in('status', ['preparing', 'shipped'])
      .not('tracking_number', 'is', null)
      .order('last_tracked_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;
    if (!shipments || shipments.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No hay shipments para rastrear' }),
        { status: 200 },
      );
    }

    // 2. Configuración de API Envia
    const mode = Deno.env.get('ENVIA_MODE') || 'sandbox';
    const apiKey =
      mode === 'sandbox'
        ? Deno.env.get('ENVIA_API_KEY_SANDBOX')
        : Deno.env.get('ENVIA_API_KEY_PROD');
    const apiUrl =
      mode === 'sandbox'
        ? 'https://api-test.envia.com'
        : 'https://api.envia.com';

    // 3. Deduplicar tracking numbers para consulta masiva
    const trackingNumbers = [
      ...new Set(shipments.map((s) => s.tracking_number)),
    ];

    // 4. Consulta masiva a Envia.com
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

    // Estados de Envia que confirman que el paquete ya está en manos de la paquetería
    const CARRIER_IN_TRANSIT_STATUSES = new Set([
      'recibido en oficina',
      'recolectado',
      'en tránsito',
      'in-store pickup',
      'in transit',
      'picked up',
    ]);

    let deliveredCount = 0;
    const processedIds: string[] = [];

    // 5. Procesar resultados
    for (const trackInfo of resData.data) {
      // Encontrar todos los shipments que coincidan con este tracking number
      const matchingShipments = shipments.filter(
        (s) => s.tracking_number === trackInfo.trackingNumber,
      );
      if (matchingShipments.length === 0) continue;

      const normalizedStatus = trackInfo.status?.toLowerCase() || '';

      for (const shipment of matchingShipments) {
        // Acumular ID para bulk update de last_tracked_at (evita N+1)
        processedIds.push(shipment.id);

        // 5a. Si el shipment sigue en 'preparing' y Envia ya lo recibió → shipped
        if (
          shipment.status === 'preparing' &&
          CARRIER_IN_TRANSIT_STATUSES.has(normalizedStatus)
        ) {
          log('INFO', `Paquete recibido por paquetería`, {
            shipmentId: shipment.id,
            orderId: shipment.order_id,
            enviaStatus: trackInfo.status,
          });
          await supabaseAdmin
            .from('shipments')
            .update({ status: 'shipped', shipped_at: new Date().toISOString() })
            .eq('id', shipment.id);
        }

        // 5b. Si el estado es entregado, disparamos la RPC atómica
        if (normalizedStatus === 'delivered') {
          log('INFO', `Paquete entregado detectado`, {
            shipmentId: shipment.id,
            orderId: shipment.order_id,
          });
          const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
            'fn_mark_shipment_delivered',
            {
              p_shipment_id: shipment.id,
            },
          );

          if (rpcError || (rpcData && !rpcData[0]?.success)) {
            log('ERROR', `Fallo al ejecutar fn_mark_shipment_delivered`, {
              shipmentId: shipment.id,
              orderId: shipment.order_id,
              error: rpcError?.message || rpcData[0]?.error_message,
            });
          } else {
            deliveredCount++;
          }
        }
      }
    }

    // 6. Bulk update: un solo viaje a DB para actualizar last_tracked_at de todos los procesados
    if (processedIds.length > 0) {
      await supabaseAdmin
        .from('shipments')
        .update({ last_tracked_at: new Date().toISOString() })
        .in('id', processedIds);
    }

    log('INFO', 'Rastreo finalizado', {
      total: shipments.length,
      delivered: deliveredCount,
    });

    return new Response(
      JSON.stringify({
        processed: shipments.length,
        delivered: deliveredCount,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    log('ERROR', 'Fallo crítico en track-shipments', { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
});
