import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// Mapeo de Cajas (Debe ser idéntico al del Frontend y al original)
const PACKAGE_DIMENSIONS: Record<
  string,
  { length: number; width: number; height: number; weight: number }
> = {
  cpu_1: { length: 15, width: 15, height: 15, weight: 1 },
  cpu_2: { length: 20, width: 15, height: 10, weight: 1 },
  ram_1: { length: 15, width: 15, height: 15, weight: 1 },
  ram_2: { length: 20, width: 15, height: 10, weight: 1 },
  gpu_1: { length: 30, width: 23, height: 15, weight: 3 },
  gpu_2: { length: 41, width: 30, height: 20, weight: 5 },
  mobo_1: { length: 46, width: 30, height: 15, weight: 5 },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { originZip, packageId } = await req.json();
    const dim = PACKAGE_DIMENSIONS[packageId];

    if (!dim) {
      console.warn(
        `[SELLER QUOTE] ¡ALERTA! El ID "${packageId}" no se encontró. Usando fallback.`,
      );
    }

    const finalDimensions = dim || {
      length: 20,
      width: 15,
      height: 10,
      weight: 1,
    };

    console.log(
      `[SELLER QUOTE] Cotizando para Origen: ${originZip}, Preset: ${packageId}`,
    );

    const baseUrl = Deno.env.get('ENVIA_API_URL') || '';
    const apiUrl = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/ship/rate`;
    const apiKey = Deno.env.get('ENVIA_API_KEY');

    // Para el vendedor, SIEMPRE usamos Estafeta para la cotización de referencia
    const payload = {
      origin: { country: 'MX', postalCode: originZip },
      // Destino genérico para obtener una cotización de referencia
      destination: {
        country: 'MX',
        postalCode: '06500', // CDMX como referencia
        street: 'Paseo de la Reforma',
        number: '505',
        district: 'Cuauhtemoc',
        city: 'Cuauhtemoc',
        state: 'CX',
      },
      packages: [
        {
          content: 'Componentes de Computadora',
          amount: 1,
          type: 'box',
          dimensions: {
            length: finalDimensions.length,
            width: finalDimensions.width,
            height: finalDimensions.height,
          },
          weight: finalDimensions.weight,
          insurance: 0,
          declaredValue: 1000,
          weightUnit: 'KG',
          lengthUnit: 'CM',
        },
      ],
      shipment: { carrier: 'estafeta', type: 1 },
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.json();

    if (!response.ok || !responseBody.data || responseBody.data.length === 0) {
      console.error(
        '[SELLER QUOTE] Envia Error:',
        JSON.stringify(responseBody),
      );
      throw new Error('No se encontraron cotizaciones de Estafeta.');
    }

    // Como es solo una opción, devolvemos el precio directo
    const rate = responseBody.data[0];
    const finalPrice = Math.ceil(rate.totalPrice + 50);

    console.log(`[SELLER QUOTE] Cotización exitosa: Estafeta - $${finalPrice}`);

    return new Response(JSON.stringify({ price: finalPrice }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[SELLER QUOTE] Error en la función:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
