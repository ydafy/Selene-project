import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

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

interface OrderItem {
  seller_id: string;
  product: {
    package_preset: string;
  };
}

interface Order {
  id: string;
  status: string;
  tracking_number: string | null;
  total_amount: number;
  shipping_address: Address;
  items: OrderItem[];
}

// --- 3. ESQUEMAS DE VALIDACIÓN ---

const RequestSchema = z.object({
  orderId: z.string().uuid('ID de orden inválido'),
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

serve(async (req) => {
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

    const { orderId, originAddress, shippingEvidence } = parseResult.data;
    log('INFO', 'Iniciando generación de guía', { orderId });

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

    // C. Fetch Paralelo (Orden + Settings)
    const [orderRes, settingsRes] = await Promise.all([
      supabaseAdmin
        .from('orders')
        .select(
          `*, items:order_items(seller_id, product:products(package_preset))`,
        )
        .eq('id', orderId)
        .single(),
      supabaseAdmin.from('system_settings').select('package_presets').single(),
    ]);

    if (orderRes.error || !orderRes.data)
      throw new ApiError(404, 'Orden no encontrada');
    if (settingsRes.error || !settingsRes.data)
      throw new ApiError(500, 'Error cargando configuración del sistema');

    const order = orderRes.data as Order;
    const packagePresets = settingsRes.data.package_presets as Record<
      string,
      PackageDimensions
    >;

    // D. Validaciones de Negocio
    if (order.tracking_number)
      throw new ApiError(409, 'La guía ya existe. No se puede duplicar.');
    if (order.status !== 'paid')
      throw new ApiError(
        422,
        'Solo se pueden generar guías de órdenes pagadas.',
      );

    const isOwner = order.items.some((item) => item.seller_id === user.id);
    if (!isOwner)
      throw new ApiError(403, 'No tienes permiso para gestionar esta orden');

    // E. Regla Anti-Fraude (Fetch Paralelo)
    const [completedRes, activeRes] = await Promise.all([
      supabaseAdmin
        .from('order_items')
        .select('id, orders!inner(status)', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .eq('orders.status', 'completed'),
      supabaseAdmin
        .from('order_items')
        .select('id, orders!inner(status)', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .in('orders.status', ['preparing', 'shipped']),
    ]);

    const completedCount = completedRes.count || 0;
    const activeCount = activeRes.count || 0;
    const isNovice = completedCount < 5;
    const limit = isNovice ? 2 : 10;

    if (activeCount >= limit) {
      throw new ApiError(
        429,
        `Límite de envíos activos alcanzado (${activeCount}/${limit}). Completa tus ventas actuales para generar más guías.`,
      );
    }

    // F. Cálculo de Dimensiones Dinámico
    let totalWeight = 0,
      maxL = 0,
      maxW = 0,
      totalH = 0;

    order.items.forEach((item) => {
      const presetKey = item.product.package_preset;
      const dim = packagePresets[presetKey];

      if (!dim) {
        log(
          'WARN',
          `Preset no encontrado: ${presetKey}. Usando fallback seguro.`,
          { orderId },
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
        name: order.shipping_address.full_name || 'Comprador Selene',
        phone: cleanPhone(order.shipping_address.phone),
        street: order.shipping_address.street_line1,
        number: 'SN',
        district: order.shipping_address.district || 'Centro',
        city: order.shipping_address.city,
        state: (originAddress.state_code || originAddress.state || 'DF')
          .substring(0, 2)
          .toUpperCase(),
        country: 'MX',
        postalCode: order.shipping_address.zip_code,
      },
      packages: [
        {
          type: 'box',
          content: `Hardware: ${orderId.slice(0, 8)}`,
          amount: 1,
          declaredValue: order.total_amount,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: totalWeight,
          dimensions: { length: maxL, width: maxW, height: totalH },
        },
      ],
      shipment: { carrier: 'paquetexpress', service: 'ground', type: 1 },
      settings: { currency: 'MXN', printFormat: 'PDF', printSize: 'STOCK_4X6' },
    };

    // H. Llamada a Envia
    log('INFO', 'Solicitando guía a Envia', {
      orderId,
      carrier: 'paquetexpress',
    });

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
      log('ERROR', 'Error de Envia.com', { orderId, enviaError: resData });
      throw new ApiError(
        422,
        resData.description || resData.message || 'Error de paquetería',
      );
    }

    // I. Persistencia Atómica
    const trackingNumber = resData.data[0].trackingNumber;
    const labelUrl = resData.data[0].label;

    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'preparing',
        tracking_number: trackingNumber,
        label_url: labelUrl,
        shipping_evidence: shippingEvidence.images,
        origin_address: originAddress,
      })
      .eq('id', orderId);

    if (updateError) {
      log('ERROR', '[CRITICAL] Guía huérfana generada', {
        orderId,
        trackingNumber,
        dbError: updateError,
      });
      throw new ApiError(
        500,
        `Guía generada pero error al sincronizar con Selene. Tu guía es: ${trackingNumber}`,
      );
    }

    log('INFO', 'Guía generada exitosamente', { orderId, trackingNumber });

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
