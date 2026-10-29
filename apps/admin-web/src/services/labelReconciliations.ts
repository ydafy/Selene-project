import {
  parseLabelReconciliations,
  parseResolveResult,
  type LabelReconciliation,
  type ResolveLabelReconciliationInput,
  type ResolveLabelReconciliationResult,
} from '../lib/labelReconciliations';
import { invokeEdgeJson } from './edge-client';

export async function fetchLabelReconciliations(): Promise<LabelReconciliation[]> {
  return parseLabelReconciliations(await invokeEdgeJson('list-shipment-label-reconciliations', { method: 'GET' }));
}

/**
 * The label cost travels as integer cents. The server takes the admin from the session, validates the
 * data and the case,; `no_label` sends no label fields at all.
 */
export async function resolveLabelReconciliation(
  input: ResolveLabelReconciliationInput,
): Promise<ResolveLabelReconciliationResult> {
  const body =
    input.resolution === 'no_label'
      ? { shipment_id: input.shipmentId, resolution: input.resolution, note: input.note }
      : {
        shipment_id: input.shipmentId,
        resolution: input.resolution,
        note: input.note,
        envia_shipment_id: input.enviaShipmentId,
        tracking_number: input.trackingNumber,
        label_url: input.labelUrl,
        provider_cost_cents: input.providerCostCents,
      };
  return parseResolveResult(await invokeEdgeJson('resolve-shipment-label-reconciliation', { method: 'POST', body }));
}
