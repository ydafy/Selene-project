import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';
import {
  buildSanitizedEnviaDiagnostics,
  buildSanitizedEnviaResponseMetadata,
  extractEnviaErrorMetadata,
  extractEnviaLabelCostCents,
  sanitizeLabelLogMetadata,
} from './diagnostics.ts';
import {
  buildEnviaShipmentConfiguration,
  buildBuyerDestinationFromStoredSnapshot,
  buildSellerOriginFromStoredAddress,
  classifyEnviaGenerateOutcome,
  projectEnviaShipmentConfiguration,
  resolveEnviaRuntimeConfiguration,
  runPaquetexpressAddressPreflight,
  runLabelClaimOrchestration,
  selectPaquetexpressGroundRate,
} from '../_shared/envia-shipping.ts';

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
      ...sanitizeLabelLogMetadata(data ?? {}),
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
  street_number?: string;
  district?: string;
  city: string;
  state?: string;
  state_code?: string;
  zip_code: string;
}

interface ShipmentItem {
  price_at_purchase: number;
  product: {
    package_preset: string;
  };
}

interface ShipmentData {
  id: string;
  seller_id: string;
  status: string;
  tracking_number: string | null;
  label_url: string | null;
  label_quote_carrier?: string | null;
  label_quote_service?: string | null;
  label_quote_cost_cents?: number | null;
  label_quote_reference?: string | null;
  label_quote_input_hash?: string | null;
  origin_address?: unknown;
  order: {
    id: string;
    total_amount: number;
    shipping_address: unknown;
  };
  items: ShipmentItem[];
}

type AcceptedLabel = {
  trackingNumber: string;
  labelUrl: string;
  enviaShipmentId: string;
  labelCost: number;
};

const enviaEndpoint = (baseUrl: string, path: string) =>
  `${baseUrl}/${path}`.replace(/([^:]\/)\/+?/g, '$1');

const hashRateInput = async (payload: Record<string, unknown>) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

// --- 3. ESQUEMAS DE VALIDACIÓN ---
const RequestSchema = z.object({
  shipmentId: z.string().uuid('ID de envío inválido'),
  originAddressId: z.string().uuid('ID de origen inválido'),
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
    log('INFO', 'Label request received');

    const parseResult = RequestSchema.safeParse(body);

    if (!parseResult.success) {
      // Esto te dirá exactamente qué campo falla: ej. "originAddress.state_code: Required"
      const errorDetails = parseResult.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');

      log('WARN', 'Request validation failed', {
        errorClass: 'invalid_request',
      });
      throw new ApiError(400, `Datos inválidos: ${errorDetails}`);
    }

    const { shipmentId, originAddressId, shippingEvidence } = parseResult.data;
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
           id, seller_id, status, tracking_number, label_url,
           label_quote_carrier, label_quote_service, label_quote_cost_cents,
           label_quote_reference, label_quote_input_hash, origin_address,
          order:order_id(id, total_amount, shipping_address),
          items:order_items!shipment_id(
            price_at_purchase,
            product:products(package_preset)
          )
        `,
        )
        .eq('id', shipmentId)
        .single(),
      supabaseAdmin
        .from('system_settings')
        .select(
          'package_presets, novice_completed_threshold, novice_active_limit, trusted_active_limit, envia_carrier, envia_service, envia_print_format, envia_print_size',
        )
        .single(),
    ]);

    if (shipmentRes.error || !shipmentRes.data)
      throw new ApiError(404, 'Envío no encontrado');
    if (settingsRes.error || !settingsRes.data)
      throw new ApiError(500, 'Error cargando configuración del sistema');

    const shipment = shipmentRes.data as unknown as ShipmentData;
    const declaredValue = shipment.items.reduce(
      (total, item) => total + item.price_at_purchase,
      0,
    );

    if (!Number.isFinite(declaredValue) || declaredValue <= 0)
      throw new ApiError(422, 'El envío no tiene un valor asegurable válido.');

    const packagePresets = settingsRes.data.package_presets as Record<
      string,
      PackageDimensions
    >;
    const enviaShipmentConfiguration = buildEnviaShipmentConfiguration(
      projectEnviaShipmentConfiguration(settingsRes.data),
    );

    if (!enviaShipmentConfiguration)
      throw new ApiError(503, 'ENVIA_CONFIGURATION_INVALID');

    // D. Validaciones de Negocio
    if (shipment.seller_id !== user.id)
      throw new ApiError(403, 'No tienes permiso para gestionar este envío');
    if (shipment.tracking_number)
      return new Response(
        JSON.stringify({
          success: true,
          labelUrl: shipment.label_url,
          trackingNumber: shipment.tracking_number,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    if (shipment.status !== 'paid')
      throw new ApiError(
        422,
        'Solo se pueden generar guías de envíos pagados.',
      );
    const buyerDestination = buildBuyerDestinationFromStoredSnapshot(
      shipment.order.shipping_address,
    );
    const { data: originAddress, error: originAddressError } = await supabaseAdmin
      .from('addresses')
      .select('full_name, phone, street_line1, street_number, district, city, state, country, zip_code')
      .eq('id', originAddressId)
      .eq('user_id', shipment.seller_id)
      .is('deleted_at', null)
      .single();
    const sellerOrigin = originAddressError
      ? null
      : buildSellerOriginFromStoredAddress(shipment.origin_address ?? originAddress);
    const preflightError = runPaquetexpressAddressPreflight(sellerOrigin, buyerDestination);
    if (preflightError) throw new ApiError(422, preflightError);

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

    // G. Validate Envia configuration and the server-loaded buyer snapshot before claim.
    const runtimeConfiguration = resolveEnviaRuntimeConfiguration({
      ENVIA_MODE: Deno.env.get('ENVIA_MODE'),
      ENVIA_API_KEY_SANDBOX: Deno.env.get('ENVIA_API_KEY_SANDBOX'),
      ENVIA_API_KEY_PROD: Deno.env.get('ENVIA_API_KEY_PROD'),
      ENVIA_API_URL_SANDBOX: Deno.env.get('ENVIA_API_URL_SANDBOX'),
      ENVIA_API_URL_PROD: Deno.env.get('ENVIA_API_URL_PROD'),
    });
    if (!runtimeConfiguration)
      throw new ApiError(503, 'ENVIA_CONFIGURATION_INVALID');

    const payload = {
      origin: {
        ...sellerOrigin!,
      },
      destination: {
        ...buyerDestination,
      },
      packages: [
        {
          type: 'box',
          content: `Hardware: ${shipment.order.id.slice(0, 8)}`,
          amount: 1,
          declaredValue,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: totalWeight,
          dimensions: { length: maxL, width: maxW, height: totalH },
          additionalServices: [
            {
              data: {
                amount: declaredValue,
              },
              service: 'envia_insurance',
            },
          ],
        },
      ],
      ...enviaShipmentConfiguration,
    };
    const rateInputHash = await hashRateInput(payload);

    const enviaDiagnostics = buildSanitizedEnviaDiagnostics(payload, {
      shipmentId,
      endpointBaseUrl: runtimeConfiguration.apiUrl,
      mode: runtimeConfiguration.mode,
      itemCount: shipment.items.length,
      presetKeys,
    });

    const { error: evidenceError } = await supabaseAdmin
      .from('shipments')
      .update({
        shipping_evidence: shippingEvidence.images,
      })
      .eq('id', shipmentId);
    if (evidenceError)
      throw new ApiError(500, 'No se pudo guardar la evidencia de envío');

    // H. Claim, send, provider, and token-guarded persistence
    log('INFO', 'Prepared Envia label request', { enviaDiagnostics });
    let acceptedRate: {
      carrier: string;
      service: string;
      quoteReference: string | null;
      quotedCostCents: number;
    } | null = null;
    const rpc = (fn: string, args: Record<string, unknown>) =>
      supabaseAdmin.rpc(fn, args);
    const result = await runLabelClaimOrchestration({
      claim: async () => {
        const { data, error } = await rpc('fn_claim_shipment_label', {
          p_shipment_id: shipmentId,
           p_seller_id: user.id,
           p_origin_address_id: originAddressId,
        });
        if (error || !data) return { status: 'ineligible' as const };
        return { status: data.status, claimToken: data.claim_token };
      },
      rateAndPersist: async (token) => {
        const reusableEvidence =
          shipment.label_quote_input_hash === rateInputHash &&
          shipment.label_quote_carrier?.trim().toLowerCase() ===
            'paquetexpress' &&
          shipment.label_quote_service?.trim().toLowerCase() === 'ground' &&
          Number.isInteger(shipment.label_quote_cost_cents) &&
          (shipment.label_quote_cost_cents ?? -1) >= 0;

        if (reusableEvidence) {
          acceptedRate = {
            carrier: shipment.label_quote_carrier!,
            service: shipment.label_quote_service!,
            quoteReference: shipment.label_quote_reference ?? null,
            quotedCostCents: shipment.label_quote_cost_cents!,
          };
        } else {
          const rateResponse = await fetch(
            enviaEndpoint(runtimeConfiguration.apiUrl, 'ship/rate/'),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${runtimeConfiguration.apiKey}`,
              },
              body: JSON.stringify(payload),
            },
          );
          const rateBody = await rateResponse.json().catch(() => null);
          acceptedRate = rateResponse.ok
            ? selectPaquetexpressGroundRate(
                rateBody && typeof rateBody === 'object'
                  ? (rateBody as { data?: unknown }).data
                  : null,
              )
            : null;
        }

        if (!acceptedRate) return false;
        const persisted = await rpc('fn_persist_shipment_label_quote', {
          p_shipment_id: shipmentId,
          p_claim_token: token,
          p_carrier: acceptedRate.carrier,
          p_service: acceptedRate.service,
          p_quote_cost_cents: acceptedRate.quotedCostCents,
          p_quote_reference: acceptedRate.quoteReference,
          p_input_hash: rateInputHash,
        });
        return persisted.data === true;
      },
      markSent: async (token) =>
        (
          await rpc('fn_mark_shipment_label_sent', {
            p_shipment_id: shipmentId,
            p_claim_token: token,
          })
        ).data === true,
      provider: async () => {
        try {
          if (!acceptedRate) return 'ambiguous';
          const generationPayload = {
            ...payload,
            shipment: {
              ...payload.shipment,
              carrier: acceptedRate.carrier,
              service: acceptedRate.service,
            },
          };
          const response = await fetch(
            enviaEndpoint(runtimeConfiguration.apiUrl, 'ship/generate/'),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${runtimeConfiguration.apiKey}`,
              },
              body: JSON.stringify(generationPayload),
            },
          );
          const data = await response.json();
          const item = data?.data?.[0];
          if (!response.ok || data.meta === 'error' || data.code >= 400) {
            log('ERROR', 'Envia rejected label request', {
              shipmentId,
              enviaDiagnostics,
              enviaError: extractEnviaErrorMetadata(data),
            });
            return classifyEnviaGenerateOutcome({
              status: response.status,
              body: {
                error: data?.error ?? data?.message,
                code: data?.code ?? data?.error?.code,
                trackingNumber: item?.trackingNumber,
                labelUrl: item?.label,
                shipmentId: item?.shipmentId,
              },
            }) === 'retryable_rejected'
              ? 'rejected'
              : 'ambiguous';
          }
          const labelCostExtraction = extractEnviaLabelCostCents(data);
          if (
            !item?.trackingNumber ||
            !item?.label ||
            item?.shipmentId == null ||
            !labelCostExtraction
          )
            return 'ambiguous';
          log('INFO', 'Extracted Envia label cost', {
            shipmentId,
            enviaResponseMetadata: buildSanitizedEnviaResponseMetadata(
              data,
              labelCostExtraction,
            ),
          });
          return {
            status: 'accepted' as const,
            accepted: {
              trackingNumber: item.trackingNumber,
              labelUrl: item.label,
              enviaShipmentId: String(item.shipmentId),
              labelCost: labelCostExtraction.shippingCostCents,
            } satisfies AcceptedLabel,
          };
        } catch {
          return 'ambiguous';
        }
      },
      finalize: async (token, accepted) =>
        accepted !== null &&
        acceptedRate !== null &&
        (
          await rpc('fn_finalize_shipment_label', {
            p_shipment_id: shipmentId,
            p_claim_token: token,
            p_envia_shipment_id: accepted.enviaShipmentId,
            p_tracking_number: accepted.trackingNumber,
            p_label_url: accepted.labelUrl,
            p_carrier: acceptedRate.carrier,
            p_service: acceptedRate.service,
            p_print_format: enviaShipmentConfiguration.settings.printFormat,
            p_print_size: enviaShipmentConfiguration.settings.printSize,
            p_provider_cost_cents: accepted.labelCost,
          })
        ).data === true,
      rejected: async (token) =>
        (
          await rpc('fn_mark_shipment_label_rejected', {
            p_shipment_id: shipmentId,
            p_claim_token: token,
            p_error_class: 'deterministic_provider_rejection',
          })
        ).data === true,
      orphan: async (token) =>
        (
          await rpc('fn_mark_shipment_label_orphan', {
            p_shipment_id: shipmentId,
            p_claim_token: token,
            p_error_class: 'provider_outcome_unproven',
          })
        ).data === true,
    });
    if (result.status === 'generated' && result.accepted)
      return new Response(
        JSON.stringify({
          success: true,
          labelUrl: result.accepted.labelUrl,
          trackingNumber: result.accepted.trackingNumber,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    if (result.status === 'generated' && !result.accepted) {
      const finalizedLabelRes = await supabaseAdmin
        .from('shipments')
        .select('label_url, tracking_number')
        .eq('id', shipmentId)
        .single();
      const finalizedLabel = finalizedLabelRes.data;

      if (
        !finalizedLabelRes.error &&
        finalizedLabel?.label_url &&
        finalizedLabel.tracking_number
      )
        return new Response(
          JSON.stringify({
            success: true,
            labelUrl: finalizedLabel.label_url,
            trackingNumber: finalizedLabel.tracking_number,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
    if (
      result.status === 'retryable_rejected' ||
      result.status === 'rate_evidence_rejected'
    )
      throw new ApiError(422, 'PAQUETEXPRESS_GROUND_UNAVAILABLE');
    if (result.status === 'orphan_pending')
      log('ERROR', '[CRITICAL] Label requires reconciliation', {
        shipmentId,
        errorClass: 'provider_or_finalize_unproven',
      });
    if (
      result.status === 'rejected_state_persistence_failed' ||
      result.status === 'orphan_state_persistence_failed'
    )
      throw new ApiError(500, 'LABEL_STATE_PERSISTENCE_FAILED');
    throw new ApiError(
      result.status === 'mark_sent_released' ||
        result.status === 'mark_sent_failed'
        ? 500
        : 409,
      result.status === 'orphan_pending'
        ? 'LABEL_RECONCILIATION_REQUIRED'
        : 'LABEL_GENERATION_CONFLICT',
    );
  } catch (error: unknown) {
    const isApiError = error instanceof ApiError;
    const status = isApiError ? error.status : 500;
    const message = isApiError ? error.message : 'Error interno del servidor';

    if (!isApiError) {
      log('ERROR', 'Unhandled label generation failure', {
        errorClass: 'unhandled_exception',
      });
    }

    log('ERROR', 'Label generation failed', {
      errorClass: isApiError ? 'api_error' : 'unhandled_exception',
      isApiError,
    });

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
