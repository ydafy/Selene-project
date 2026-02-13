import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const PACKAGE_DIMENSIONS: Record<
  string,
  { length: number; width: number; height: number; weight: number }
> = {
  ram_1: { length: 15, width: 15, height: 15, weight: 1 },
  ram_2: { length: 20, width: 15, height: 10, weight: 1 },
  cpu_1: { length: 15, width: 15, height: 15, weight: 1 },
  cpu_2: { length: 20, width: 15, height: 10, weight: 1 },
  gpu_1: { length: 30, width: 23, height: 15, weight: 3 },
  gpu_2: { length: 41, width: 30, height: 20, weight: 5 },
  mobo_1: { length: 46, width: 30, height: 15, weight: 5 },
};

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const { originZip, packageId, destinationZip, price } = await req.json();

    const destZip = destinationZip || '06500';
    const dim = PACKAGE_DIMENSIONS[packageId] || {
      length: 20,
      width: 15,
      height: 10,
      weight: 1,
    };
    const declaredValue = Number(price) || 500;

    const finalUrl = `https://api.envia.com/ship/rate/`;

    // PAYLOAD SIGUIENDO LA DOCUMENTACIÓN OFICIAL (BODY PARAMS)
    const payload = {
      origin: {
        name: 'Selene Seller',
        company: 'Selene Marketplace',
        email: 'soporte@selene.com',
        phone: '5512345678',
        street: 'Av. Principal',
        number: '123',
        district: 'Centro',
        city: 'Mexico', // Placeholder requerido
        state: 'MX', // Placeholder requerido
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
        city: 'Mexico', // Placeholder requerido
        state: 'MX', // Placeholder requerido
        country: 'MX',
        postalCode: destZip.toString(),
      },
      packages: [
        {
          type: 'box', // Enum: box
          content: 'Componentes de Computadora', // Required
          amount: 1, // Required
          name: 'Hardware',
          declaredValue: declaredValue, // Required
          lengthUnit: 'CM', // Required Enum
          weightUnit: 'KG', // Required Enum
          weight: Number(dim.weight), // Required
          dimensions: {
            length: Number(dim.length),
            width: Number(dim.width),
            height: Number(dim.height),
          },
        },
      ],
      shipment: {
        type: 1, // 1 para paquete
        carrier: 'estafeta',
      },
      settings: {
        currency: 'MXN',
      },
    };

    console.log(`[QUOTE] ${originZip} -> ${destZip} | Value: ${declaredValue}`);

    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${Deno.env.get('ENVIA_API_KEY')}`,
      },
      body: JSON.stringify(payload),
    });

    const resData = await response.json();

    if (
      !response.ok ||
      resData.meta === 'error' ||
      !resData.data ||
      resData.data.length === 0
    ) {
      console.error(`[ENVIA ERROR]`, JSON.stringify(resData));
      return new Response(
        JSON.stringify({ rates: [], message: 'Error en cotización' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Ordenar por precio y tomar el más barato de Estafeta
    const rates = resData.data
      .map((rate: any) => ({
        carrier: rate.carrier,
        service: rate.service,
        price: Math.ceil(Number(rate.totalPrice) + 50),
        currency: rate.currency,
        deliveryEstimate: rate.deliveryEstimate,
      }))
      .sort((a: any, b: any) => a.price - b.price);

    return new Response(JSON.stringify({ rates: [rates[0]] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`[CRITICAL ERROR]`, error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
