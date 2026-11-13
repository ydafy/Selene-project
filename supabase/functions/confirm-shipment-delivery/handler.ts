import type { SupabaseClient } from '../_shared/supabase-js.ts';

import {
  ApiError,
  buildConfirmationDiagnostic,
  mapConfirmationRpcResult,
  resolveBuyerConfirmationPlan,
} from './confirm-shipment-delivery.ts';
import { ConfirmationRequestSchema } from './request-schema.ts';

export type SupabaseAdminClient = SupabaseClient;

export interface ConfirmShipmentDeliveryDependencies {
  // Called once per request, after the body is valid.
  createSupabaseAdmin: () => SupabaseAdminClient;
}

const log = (
  level: 'INFO' | 'ERROR',
  msg: string,
  data: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'confirm-shipment-delivery',
      level,
      msg,
      ...data,
    }),
  );
};

export function createConfirmShipmentDeliveryHandler(
  dependencies: ConfirmShipmentDeliveryDependencies,
) {
  return async (req: Request): Promise<Response> => {
    let request:
      | { orderId: string; shipmentId: string; idempotencyKey: string }
      | undefined;

    try {
      if (req.method !== 'POST') {
        throw new ApiError(400, 'INVALID_REQUEST');
      }

      const body = await req.json().catch(() => null);
      const parsed = ConfirmationRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError(400, 'INVALID_REQUEST');
      }
      request = parsed.data;

      const supabaseAdmin = dependencies.createSupabaseAdmin();

      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new ApiError(401, 'AUTH_REQUIRED');
      }

      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) {
        throw new ApiError(401, 'AUTH_REQUIRED');
      }

      const { data: settings, error: settingsError } = await supabaseAdmin
        .from('system_settings')
        .select('is_maintenance')
        .eq('id', 1)
        .single();
      if (settingsError || !settings) {
        throw new ApiError(500, 'INTERNAL_ERROR');
      }

      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .select('id, buyer_id')
        .eq('id', request.orderId)
        .maybeSingle();
      if (orderError || !order) {
        throw new ApiError(404, 'SHIPMENT_NOT_FOUND');
      }

      const { data: shipment, error: shipmentError } = await supabaseAdmin
        .from('shipments')
        .select('id, order_id, status')
        .eq('id', request.shipmentId)
        .eq('order_id', request.orderId)
        .maybeSingle();
      if (shipmentError || !shipment) {
        throw new ApiError(404, 'SHIPMENT_NOT_FOUND');
      }

      const { data: activeDispute, error: disputeError } = await supabaseAdmin
        .from('disputes')
        .select('id')
        .eq('shipment_id', request.shipmentId)
        .not('status', 'in', '(resolved,rejected)')
        .maybeSingle();
      if (disputeError) {
        throw new ApiError(500, 'INTERNAL_ERROR');
      }

      const rpcInput = resolveBuyerConfirmationPlan({
        isMaintenance: settings.is_maintenance,
        actorId: user.id,
        order,
        shipment,
        hasActiveDispute: Boolean(activeDispute),
      });

      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
        'fn_confirm_shipment_delivery',
        rpcInput,
      );
      if (rpcError) {
        throw new ApiError(500, 'INTERNAL_ERROR');
      }

      const result = mapConfirmationRpcResult(
        Array.isArray(rpcData) ? rpcData[0] : rpcData,
        request.shipmentId,
      );
      log(
        'INFO',
        'Shipment confirmation completed',
        buildConfirmationDiagnostic({
          shipmentId: request.shipmentId,
          idempotencyKey: request.idempotencyKey,
          result: 'success',
          code: result.idempotent ? 'IDEMPOTENT_SUCCESS' : 'COMPLETED',
        }),
      );

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      const apiError =
        error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR');

      log(
        'ERROR',
        'Shipment confirmation failed',
        request
          ? buildConfirmationDiagnostic({
              shipmentId: request.shipmentId,
              idempotencyKey: request.idempotencyKey,
              result: 'failure',
              code: apiError.code,
            })
          : { source: 'buyer', result: 'failure', code: apiError.code },
      );

      return new Response(
        JSON.stringify({ success: false, error: apiError.code }),
        {
          status: apiError.status,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  };
}
