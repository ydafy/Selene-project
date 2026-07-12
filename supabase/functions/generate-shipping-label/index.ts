import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';
import {
  buildSanitizedEnviaDiagnostics,
  buildSanitizedEnviaResponseMetadata,
  extractEnviaErrorMetadata,
  extractEnviaLabelCostCents,
} from './diagnostics.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// --- 1. UTILIDADES CORE ---

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
      function: 'generate-shipping-label',
      level,
      msg,
      ...data,
    }),
  );
};

// --- 2. TIPOS E INTERFACES ---

interface PackageDimensions {
  length: number;
  width: number;
  height: number;
  weight: number;
}

interface Address {
  full_name?: string;
  phone: string;
  street_line1: string;
  district?: string;
  city: string;
  state?: string;
  state_code?: string;
  zip_code: string;
}

interface ShipmentItem {
  product: {
    package_preset: string;
    price: number;
  };
}

interface ShipmentData {
  id: string;
  seller_id: string;
  status: string;
  tracking_number: string | null;
  order: {
    id: string;
    total_amount: number;
    shipping_address: Address;
  };
  items: ShipmentItem[];
}

// --- 3. ESQUEMAS DE VALIDACIÓN ---
const RequestSchema = z.object({
  shipmentId: z.string().uuid('ID de envío inválido'),
  originAddress: z.object({
    full_name: z.string().min(3, 'Nombre es obligatorio'),
    phone: z.string().min(10, 'Teléfono inválido'),
    street_line1: z.string().min(1, 'Calle es obligatoria'),
    street_line2: z.string().optional().nullable(),
    district: z.string().min(1, 'Colonia es obligatoria'),
    city: z.string().min(1, 'Ciudad es obligatoria'),
    state: z.string().optional().nullable(),
    state_code: z.string().optional().nullable(),
    zip_code: z.string().min(4, 'CP inválido'),
  }),
  shippingEvidence: z.object({
    images: z.array(z.string().url()),
  }),
});

// --- 4. FUNCIÓN PRINCIPAL ---

serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    // A. Parseo y Validación de Input
    const body = await req.json().catch(() => ({}));
    log('INFO', 'Body recibido en el Edge', { body });

    const parseResult = RequestSchema.safeParse(body);

    if (!parseResult.success) {
      // Esto te dirá exactamente qué campo falla: ej. "originAddress.state_code: Required"
      const errorDetails = parseResult.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');

      log('WARN', 'Fallo de validación Zod', { errorDetails });
      throw new ApiError(400, `Datos inválidos: ${errorDetails}`);
    }

    const { shipmentId, originAddress, shippingEvidence } = parseResult.data;
    log('INFO', 'Iniciando generación de guía', { shipmentId });

    // B. Autenticación
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );

    if (authError || !user) throw new ApiError(401, 'No autorizado');

    // C. Fetch Paralelo (Shipment + Padre Order + Settings)
    const [shipmentRes, settingsRes] = await Promise.all([
      supabaseAdmin
        .from('shipments')
        .select(
          `
          id, seller_id, status, tracking_number,
          order:order_id(id, total_amount, shipping_address),
          items:order_items!shipment_id(product:products(package_preset, price))
        `,
        )
        .eq('id', shipmentId)
        .single(),
      supabaseAdmin
        .from('system_settings')
        .select(
          'package_presets, novice_completed_threshold, novice_active_limit, trusted_active_limit',
        )
        .single(),
    ]);

    if (shipmentRes.error || !shipmentRes.data)
      throw new ApiError(404, 'Envío no encontrado');
    if (settingsRes.error || !settingsRes.data)
      throw new ApiError(500, 'Error cargando configuración del sistema');

    const shipment = shipmentRes.data as unknown as ShipmentData;
    const packagePresets = settingsRes.data.package_presets as Record<
      string,
      PackageDimensions
    >;

    // D. Validaciones de Negocio
    if (shipment.tracking_number)
      throw new ApiError(409, 'La guía ya existe. No se puede duplicar.');
    if (shipment.status !== 'paid')
      throw new ApiError(
        422,
        'Solo se pueden generar guías de envíos pagados.',
      );

    if (shipment.seller_id !== user.id)
      throw new ApiError(403, 'No tienes permiso para gestionar este envío');

    // E. Regla Anti-Fraude (Shipments del seller)
    const [completedRes, activeRes] = await Promise.all([
      supabaseAdmin
        .from('shipments')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .eq('status', 'completed'),
      supabaseAdmin
        .from('shipments')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .in('status', [
          'preparing',
          'shipped',
          'delivered',
          'dispute',
          'waiting_return',
          'return_shipped',
        ]),
    ]);

    const completedCount = completedRes.count || 0;
    const activeCount = activeRes.count || 0;

    // Extraer límites dinámicos desde la respuesta de system_settings con fallbacks seguros
    const noviceThreshold = settingsRes.data.novice_completed_threshold ?? 3;
    const noviceLimit = settingsRes.data.novice_active_limit ?? 3;
    const trustedLimit = settingsRes.data.trusted_active_limit ?? 10;

    const isNovice = completedCount < noviceThreshold;
    const limit = isNovice ? noviceLimit : trustedLimit;

    if (activeCount >= limit) {
      throw new ApiError(
        429,
        `Límite de envíos activos alcanzado (${activeCount}/${limit}). Completa tus ventas actuales para generar más guías.`,
      );
    }

    // F. Cálculo de Dimensiones Dinámico (solo items de este shipment)
    let totalWeight = 0,
      maxL = 0,
      maxW = 0,
      totalH = 0;

    const presetKeys = shipment.items.map(
      (item) => item.product.package_preset,
    );

    shipment.items.forEach((item) => {
      const presetKey = item.product.package_preset;
      const dim = packagePresets[presetKey];

      if (!dim) {
        log(
          'WARN',
          `Preset no encontrado: ${presetKey}. Usando fallback seguro.`,
          { shipmentId },
        );
      }

      // Fallback seguro a un paquete estándar si el preset no existe en la DB
      const safeDim = dim || { length: 20, width: 20, height: 15, weight: 1 };

      totalWeight += safeDim.weight;
      maxL = Math.max(maxL, safeDim.length);
      maxW = Math.max(maxW, safeDim.width);
      totalH += safeDim.height;
    });

    // G. Configuración Envia.com
    const mode = Deno.env.get('ENVIA_MODE') || 'sandbox';
    const apiKey =
      mode === 'sandbox'
        ? Deno.env.get('ENVIA_API_KEY_SANDBOX')
        : Deno.env.get('ENVIA_API_KEY_PROD');
    const apiUrl =
      mode === 'sandbox'
        ? Deno.env.get('ENVIA_API_URL_SANDBOX')
        : Deno.env.get('ENVIA_API_URL_PROD');

    const cleanPhone = (p: string) =>
      String(p || '5500000000')
        .replace(/\D/g, '')
        .slice(-10);

    const payload = {
      origin: {
        name: user.user_metadata.username || 'Vendedor Selene',
        phone: cleanPhone(originAddress.phone),
        street: originAddress.street_line1,
        number: 'SN',
        district: originAddress.district || 'Centro',
        city: originAddress.city,
        state: (originAddress.state_code || originAddress.state || 'DF')
          .substring(0, 2)
          .toUpperCase(),
        country: 'MX',
        postalCode: originAddress.zip_code,
      },
      destination: {
        name: shipment.order.shipping_address.full_name || 'Comprador Selene',
        phone: cleanPhone(shipment.order.shipping_address.phone),
        street: shipment.order.shipping_address.street_line1,
        number: 'SN',
        district: shipment.order.shipping_address.district || 'Centro',
        city: shipment.order.shipping_address.city,
        state: (
          shipment.order.shipping_address.state_code ||
          shipment.order.shipping_address.state ||
          'DF'
        )
          .substring(0, 2)
          .toUpperCase(),
        country: 'MX',
        postalCode: shipment.order.shipping_address.zip_code,
      },
      packages: [
        {
          type: 'box',
          content: `Hardware: ${shipment.order.id.slice(0, 8)}`,
          amount: 1,
          declaredValue: shipment.order.total_amount,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: totalWeight,
          dimensions: { length: maxL, width: maxW, height: totalH },
          additionalServices: [
            {
              data: {
                amount: shipment.order.total_amount,
              },
              service: 'envia_insurance',
            },
          ],
        },
      ],
      shipment: { carrier: 'estafeta', service: 'ground', type: 1 },
      settings: { currency: 'MXN', printFormat: 'PDF', printSize: 'STOCK_4X6' },
    };

    const enviaDiagnostics = buildSanitizedEnviaDiagnostics(payload, {
      shipmentId,
      endpointBaseUrl: apiUrl,
      mode,
      itemCount: shipment.items.length,
      presetKeys,
    });

    // H. Llamada a Envia
    log('INFO', 'Prepared Envia label request', { enviaDiagnostics });

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
        shipmentId,
        enviaDiagnostics,
        enviaError: extractEnviaErrorMetadata(resData),
      });
      throw new ApiError(
        422,
        resData.description || resData.message || 'Error de paquetería',
      );
    }

    // I. Persistencia Atómica
    const trackingNumber = resData.data[0].trackingNumber;
    const labelUrl = resData.data[0].label;
    const enviaShipmentId = resData.data[0].shipmentId?.toString() || null;
    const labelCost = extractEnviaLabelCostCents(resData);
    const enviaResponseMetadata = buildSanitizedEnviaResponseMetadata(
      resData,
      labelCost,
    );

    if (!labelCost) {
      log('WARN', 'Envia label response did not include a usable cost', {
        shipmentId,
        enviaResponseMetadata,
      });
    } else {
      log('INFO', 'Extracted Envia label cost', {
        shipmentId,
        enviaResponseMetadata,
      });
    }

    const shipmentUpdate = {
      status: 'preparing',
      tracking_number: trackingNumber,
      label_url: labelUrl,
      carrier: 'estafeta',
      envia_shipment_id: enviaShipmentId,
      shipping_evidence: shippingEvidence.images,
      origin_address: originAddress,
    };

    const { error: updateError } = await supabaseAdmin
      .from('shipments')
      .update(shipmentUpdate)
      .eq('id', shipmentId);

    if (updateError) {
      log('ERROR', '[CRITICAL] Guía huérfana generada', {
        shipmentId,
        trackingNumber,
        dbError: updateError,
      });
      throw new ApiError(
        500,
        `Guía generada pero error al sincronizar con Selene. Tu guía es: ${trackingNumber}`,
      );
    }

    log('INFO', 'Guía generada exitosamente', { shipmentId, trackingNumber });

    return new Response(
      JSON.stringify({ success: true, labelUrl, trackingNumber }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const isApiError = error instanceof ApiError;
    const status = isApiError ? error.status : 500;
    const message = isApiError ? error.message : 'Error interno del servidor';

    if (!isApiError) {
      log('ERROR', 'Excepción no controlada', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
    }

    log('ERROR', 'Fallo en la ejecución', {
      message: (error as Error).message,
      stack: (error as Error).stack,
      isApiError,
    });

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
