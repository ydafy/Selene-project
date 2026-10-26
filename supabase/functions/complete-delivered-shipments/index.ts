import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import {
  ApiError,
  AUTO_COMPLETION_DELAY_MS,
  MAX_AUTO_COMPLETION_BATCH_SIZE,
  type AutoCompletionResult,
  buildAutoCompletionDiagnostic,
  buildAutoCompletionRpcInput,
  isActiveDisputeRefusal,
  mapAutoCompletionRpcResult,
  resolveAutoCompletionPlan,
  summarizeAutoCompletionResults,
  validateAutoCompletionRequest,
} from './complete-delivered-shipments.ts';

const log = (
  level: 'INFO' | 'ERROR',
  msg: string,
  data: Record<string, unknown>,
): void => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'complete-delivered-shipments',
      level,
      msg,
      ...data,
    }),
  );
};

serve(async (req: Request): Promise<Response> => {
  try {
    validateAutoCompletionRequest({
      method: req.method,
      suppliedCronSecret: req.headers.get('x-cron-secret'),
      expectedCronSecret: Deno.env.get('CRON_SECRET') ?? null,
    });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const now = Date.now();
    const dueAt = new Date(now - AUTO_COMPLETION_DELAY_MS).toISOString();

    // Excluded in the query, not after it: a disputed shipment can never complete, so letting
    // it fill the batch would block every shipment delivered after it.
    const { data: disputes, error: disputesError } = await supabaseAdmin
      .from('disputes')
      .select('shipment_id')
      .not('status', 'in', '(resolved,rejected)')
      .not('shipment_id', 'is', null);
    if (disputesError || !disputes) {
      throw new ApiError(500, 'INTERNAL_ERROR');
    }
    const activeDisputeShipmentIds = [
      ...new Set(disputes.map((dispute) => dispute.shipment_id as string)),
    ];

    let candidatesQuery = supabaseAdmin
      .from('shipments')
      .select('id, status, delivered_at, buyer_confirmed_at')
      .eq('status', 'delivered')
      .is('buyer_confirmed_at', null)
      .lte('delivered_at', dueAt);
    if (activeDisputeShipmentIds.length > 0) {
      candidatesQuery = candidatesQuery.not('id', 'in', `(${activeDisputeShipmentIds.join(',')})`);
    }
    const { data: candidates, error: candidatesError } = await candidatesQuery
      .order('delivered_at', { ascending: true })
      .limit(MAX_AUTO_COMPLETION_BATCH_SIZE);

    if (candidatesError || !candidates) {
      throw new ApiError(500, 'INTERNAL_ERROR');
    }

    const { shipmentIds } = resolveAutoCompletionPlan({
      method: req.method,
      suppliedCronSecret: req.headers.get('x-cron-secret'),
      expectedCronSecret: Deno.env.get('CRON_SECRET') ?? null,
      now,
      candidates,
      activeDisputeShipmentIds,
    });
    const results: (AutoCompletionResult | 'skipped' | null)[] = [];

    for (const shipmentId of shipmentIds) {
      try {
        const { data, error } = await supabaseAdmin.rpc(
          'fn_confirm_shipment_delivery',
          buildAutoCompletionRpcInput(shipmentId),
        );
        if (error) {
          throw new ApiError(500, 'INTERNAL_ERROR');
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (isActiveDisputeRefusal(row)) {
          results.push('skipped');
          log(
            'INFO',
            'Delivered shipment completion skipped',
            buildAutoCompletionDiagnostic({
              shipmentId,
              result: 'success',
              code: 'SKIPPED_ACTIVE_DISPUTE',
            }),
          );
          continue;
        }

        const result = mapAutoCompletionRpcResult(row, shipmentId);
        results.push(result);
        log(
          'INFO',
          'Delivered shipment completion processed',
          buildAutoCompletionDiagnostic({
            shipmentId,
            result: 'success',
            code: result.idempotent ? 'IDEMPOTENT_SUCCESS' : 'COMPLETED',
          }),
        );
      } catch (error: unknown) {
        const apiError =
          error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR');
        results.push(null);
        log(
          'ERROR',
          'Delivered shipment completion failed',
          buildAutoCompletionDiagnostic({
            shipmentId,
            result: 'failure',
            code: apiError.code,
          }),
        );
      }
    }

    const result = summarizeAutoCompletionResults(results);
    log(
      result.success ? 'INFO' : 'ERROR',
      'Delivered shipment completion batch finished',
      buildAutoCompletionDiagnostic({
        result: result.success ? 'success' : 'failure',
        code: result.success ? 'BATCH_COMPLETED' : 'BATCH_PARTIAL_FAILURE',
      }),
    );

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const apiError =
      error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR');
    log(
      'ERROR',
      'Delivered shipment completion request failed',
      buildAutoCompletionDiagnostic({ result: 'failure', code: apiError.code }),
    );

    return new Response(
      JSON.stringify({ success: false, error: apiError.code }),
      {
        status: apiError.status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
});
