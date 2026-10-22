import {
  parseRefundProblems,
  parseResolveResult,
  type RefundProblem,
  type ResolveRefundResult,
} from '../lib/shipmentRefundProblems';
import { invokeEdgeJson } from './edge-client';

export async function fetchShipmentRefundProblems(): Promise<RefundProblem[]> {
  return parseRefundProblems(await invokeEdgeJson('list-shipment-refund-problems', { method: 'GET' }));
}

/** The server validates the reference and rebuilds the amount; only the ids and the reference are sent. */
export async function resolveShipmentRefund(shipmentId: string, reference: string): Promise<ResolveRefundResult> {
  return parseResolveResult(
    await invokeEdgeJson('resolve-shipment-refund', {
      method: 'POST',
      body: { shipment_id: shipmentId, reference },
    }),
  );
}
