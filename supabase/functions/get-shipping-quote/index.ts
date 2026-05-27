import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RequestSchema = z.object({
  originZip: z.string().length(5),
  packageId: z.string(),
  destinationZip: z.string().optional(),
  price: z.number().positive(),
});

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
      function: 'get-shipping-quote',
      ...meta,
    }),
  );
};

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    log('info', '--- Starting Shipping Quote ---');

    const enviaKey = Deno.env.get('ENVIA_API_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!enviaKey || !serviceRoleKey) throw new Error('MISSING_SERVER_CONFIG');

    // 2. VALIDAR INPUT
    const body = await req.json();
    const result = RequestSchema.safeParse(body);
    if (!result.success) throw new Error('INVALID_INPUT');
    const { originZip, packageId, destinationZip, price } = result.data;
    log('info', 'Parámetros recibidos', {
      originZip,
      packageId,
      destinationZip: destinationZip || '06500',
      price,
    });

    // 3. OBTENER CONFIGURACIÓN DE DB
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    );
    const { data: sys } = await supabaseAdmin
      .from('system_settings')
      .select('package_presets, shipping_buffer_cents')
      .eq('id', 1)
      .single();
    if (!sys) throw new Error('SYSTEM_CONFIG_NOT_FOUND');

    log('info', 'System config loaded', {
      shipping_buffer_cents: sys.shipping_buffer_cents,
      available_presets: Object.keys(sys.package_presets || {}),
    });

    const destZip = destinationZip || '06500';

    // Usamos los presets de la DB en lugar de la constante local
    const dim = sys.package_presets[packageId] || sys.package_presets['cpu_1'];
    const declaredValue = price || 500;

    const finalUrl = `https://api.envia.com/ship/rate/`;

    const payload = {
      origin: {
        name: 'Selene Seller',
        company: 'Selene Marketplace',
        email: 'soporte@selene.com',
        phone: '5512345678',
        street: 'Av. Principal',
        number: '123',
        district: 'Centro',
        city: 'Mexico',
        state: 'MX',
        country: 'MX',
        postalCode: originZip.toString(),
      },
      destination: {
        name: 'Selene Buyer',
        company: 'Particular',
        email: 'comprador@selene.com',
        phone: '5512345678',
        street: 'Av. Destino',
        number: '456',
        district: 'Centro',
        city: 'Mexico',
        state: 'MX',
        country: 'MX',
        postalCode: destZip.toString(),
      },
      packages: [
        {
          type: 'box',
          content: 'Componentes de Computadora',
          amount: 1,
          name: 'Hardware',
          declaredValue: declaredValue,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: Number(dim.weight),
          dimensions: {
            length: Number(dim.length),
            width: Number(dim.width),
            height: Number(dim.height),
          },
          additionalServices: [
            {
              service: 'envia_insurance',
              data: {
                amount: price.toString(), // Aseguramos el valor total del producto
              },
            },
          ],
        },
      ],

      shipment: {
        type: 1,
        carrier: 'paquetexpress',
      },
      settings: {
        currency: 'MXN',
      },
    };

    // 5. PETICIÓN A API EXTERNA
    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${enviaKey}`,
      },
      body: JSON.stringify(payload),
    });

    const resData = await response.json();

    if (!response.ok || !resData.data || resData.data.length === 0) {
      log('error', 'Envia API Error', { response: resData });
      throw new Error('CARRIER_ERROR');
    }

    // 6. PROCESAMIENTO DE TARIFAS Y SEGUROS
    const rates = resData.data
      .map((rate: any) => {
        return {
          carrier: rate.carrier,
          service: rate.service,
          price: Number(rate.totalPrice),
          insurance: Number(rate.insurance) || 0,
          currency: rate.currency,
          deliveryEstimate: rate.deliveryEstimate,
        };
      })
      .sort((a: any, b: any) => a.price - b.price);

    // 7. LOG DE AUDITORÍA ÚNICO (Módulo al 99%)
    const winner = rates[0];
    log('info', 'Logística Raw Recibida', {
      envia_total: winner.price,
      envia_ins: winner.insurance,
      route: `${originZip} -> ${destZip}`,
    });

    return new Response(JSON.stringify({ rates: [winner] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    const message = error.message || String(error);
    log('error', 'Request failed', { message });

    const statusMap: Record<string, number> = {
      MISSING_SERVER_CONFIG: 500,
      INVALID_INPUT: 422,
      SYSTEM_CONFIG_NOT_FOUND: 500,
      CARRIER_ERROR: 502,
    };

    return new Response(JSON.stringify({ error: message }), {
      status: statusMap[message] || 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
