import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ItemSchema = z.object({
  originZip: z.string().length(5),
  packageId: z.string(),
  price: z.number().positive(),
  sellerId: z.string(),
});

const RequestSchema = z.object({
  items: z.array(ItemSchema).min(1),
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
  insurance: string;
  currency: string;
  deliveryEstimate: string;
}

interface EnviaRate {
  carrier: string;
  service: string;
  price: number;
  insurance: number;
  currency: string;
  deliveryEstimate: string;
}

type QuoteItem = z.infer<typeof ItemSchema>;

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

function buildEnviaPayload(
  originZip: string,
  destZip: string,
  items: Array<{ packageId: string; price: number }>,
  packagePresets: Record<string, PackagePreset>,
): Record<string, unknown> {
  const packages = items.map((item) => {
    const dim = packagePresets[item.packageId] || packagePresets['cpu_1'];
    return {
      type: 'box',
      content: 'Componentes de Computadora',
      amount: 1,
      name: 'Hardware',
      declaredValue: item.price || 500,
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
          data: { amount: item.price.toString() },
        },
      ],
    };
  });

  return {
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
    packages,
    shipment: { type: 1, carrier: 'paquetexpress' },
    settings: { currency: 'MXN' },
  };
}

async function fetchEnviaRate(
  enviaKey: string,
  payload: Record<string, unknown>,
): Promise<EnviaRate[]> {
  const response = await fetch('https://api.envia.com/ship/rate/', {
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
    throw new Error(resData.message || 'CARRIER_ERROR');
  }

  return (resData.data as EnviaRawRate[])
    .map((rate) => ({
      carrier: rate.carrier,
      service: rate.service,
      price: Number(rate.totalPrice),
      insurance: Number(rate.insurance) || 0,
      currency: rate.currency,
      deliveryEstimate: rate.deliveryEstimate,
    }))
    .sort((a: EnviaRate, b: EnviaRate) => a.price - b.price);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    log('info', '--- Starting Multi-Origin Shipping Quote ---');

    const enviaKey = Deno.env.get('ENVIA_API_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!enviaKey || !serviceRoleKey) throw new Error('MISSING_SERVER_CONFIG');

    // 1. VALIDAR INPUT
    const body = await req.json();
    const result = RequestSchema.safeParse(body);
    if (!result.success) throw new Error('INVALID_INPUT');
    const { items, destinationZip } = result.data;
    const destZip = destinationZip || '06500';

    log('info', 'Items recibidos', {
      count: items.length,
      sellers: [...new Set(items.map((i: QuoteItem) => i.sellerId))],
      destination: destZip,
    });

    // 2. OBTENER CONFIGURACIÓN DE DB
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

    // 3. AGRUPAR ITEMS POR (originZip + sellerId)
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const key = `${item.originZip}|${item.sellerId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    log('info', `Grupos formados: ${groups.size}`, {
      groups: [...groups.keys()],
    });

    // 4. LLAMADA A ENVIA POR CADA GRUPO (con aislamiento de errores)
    const rates: Record<string, EnviaRate> = {};
    const groupErrors: Record<string, string> = {};

    const promises = [...groups.entries()].map(async ([key, groupItems]) => {
      const [originZip, sellerId] = key.split('|');
      const payload = buildEnviaPayload(
        originZip,
        destZip,
        groupItems.map((i: QuoteItem) => ({
          packageId: i.packageId,
          price: i.price,
        })),
        sys.package_presets,
      );

      try {
        const sorted = await fetchEnviaRate(enviaKey, payload);
        const winner = sorted[0];

        log('info', 'Rate obtenido por grupo', {
          sellerId,
          originZip,
          envia_total: winner.price,
          envia_ins: winner.insurance,
        });

        rates[sellerId] = winner;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log('error', 'Error en grupo de envío (aislado)', {
          sellerId,
          originZip,
          error: msg,
        });
        groupErrors[sellerId] = msg;
      }
    });

    await Promise.allSettled(promises);

    // 5. RESPONDER
    const responsePayload: Record<string, unknown> = { rates };

    if (Object.keys(groupErrors).length > 0) {
      responsePayload.errors = groupErrors;
    }

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', 'Request failed', { message });

    const statusMap: Record<string, number> = {
      MISSING_SERVER_CONFIG: 500,
      INVALID_INPUT: 422,
      SYSTEM_CONFIG_NOT_FOUND: 500,
    };

    return new Response(JSON.stringify({ error: message }), {
      status: statusMap[message] || 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
