import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RequestSchema = z.object({
  originZip: z.string().min(4).max(5),
  packageId: z.string(),
  price: z.number().positive(),
  destinationZip: z.string().optional(),
});

interface PackagePreset {
  weight: string;
  length: string;
  width: string;
  height: string;
}

interface EnviaRawRate {
  carrier: string;
  service: string;
  totalPrice: string;
  currency: string;
}

const log = (level: string, message: string, meta?: unknown) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'get-shipping-quote',
      level,
      message,
      ...((meta as Record<string, unknown>) || {}),
    }),
  );
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const enviaKey = Deno.env.get('ENVIA_API_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!enviaKey || !serviceRoleKey) {
      throw new Error('MISSING_SERVER_CONFIG');
    }

    const body = await req.json();
    const result = RequestSchema.safeParse(body);
    if (!result.success) {
      log('error', 'INVALID_INPUT', { issues: result.error.issues });
      throw new Error('INVALID_INPUT');
    }

    const { originZip, packageId, price, destinationZip } = result.data;
    const destZip = destinationZip || '06500';

    log('info', '--- Starting Single Shipping Quote ---', {
      originZip,
      packageId,
      price,
    });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    );
    const { data: sys } = await supabaseAdmin
      .from('system_settings')
      .select('package_presets')
      .eq('id', 1)
      .single();

    if (!sys || !sys.package_presets) {
      throw new Error('SYSTEM_CONFIG_NOT_FOUND');
    }

    const presets = sys.package_presets as Record<string, PackagePreset>;
    const dim = presets[packageId] ||
      presets['cpu_1'] || {
        weight: '1',
        length: '20',
        width: '20',
        height: '10',
      };

    const enviaPayload = {
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
        postalCode: originZip.padStart(5, '0'),
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
        postalCode: destZip.padStart(5, '0'),
      },
      packages: [
        {
          type: 'box',
          content: 'Hardware de PC',
          amount: 1,
          name: packageId,
          declaredValue: 0,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: Number(dim.weight),
          dimensions: {
            length: Number(dim.length),
            width: Number(dim.width),
            height: Number(dim.height),
          },
        },
      ],
      shipment: { type: 1, carrier: 'estafeta', service: 'ground' },
      settings: { currency: 'MXN' },
    };

    const enviaRes = await fetch('https://api.envia.com/ship/rate/', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${enviaKey}`,
      },
      body: JSON.stringify(enviaPayload),
    });

    const resData = await enviaRes.json();
    if (!enviaRes.ok || !resData.data || resData.data.length === 0) {
      throw new Error(resData.message || 'CARRIER_ERROR');
    }

    const rates = (resData.data as EnviaRawRate[]).map((rate) => ({
      carrier: rate.carrier,
      service: rate.service,
      price: Number(rate.totalPrice),
      estimated_days: 3,
    }));

    log('info', 'Tarifas estimadas por Envia.com en la publicación', {
      originZip,
      packageId,
      price,
      destinationZip: destZip,
      ratesCount: rates.length,
      winningRate: rates[0],
    });

    return new Response(JSON.stringify({ rates }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'INVALID_INPUT' ? 422 : 400;
    log('error', message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
