import {
  parseCarrierReviews,
  parseResolveReviewResult,
  type CarrierReview,
  type ResolveReviewResult,
  type ReviewResolution,
} from '../lib/carrierReviews';
import { invokeEdgeJson } from './edge-client';

export async function fetchCarrierReviews(): Promise<CarrierReview[]> {
  return parseCarrierReviews(await invokeEdgeJson('list-shipment-operation-reviews', { method: 'GET' }));
}

/** The server validates the note and the shipment state; only the ids, the decision and the note are sent. */
export async function resolveCarrierReview(
  shipmentId: string,
  resolution: ReviewResolution,
  note: string,
): Promise<ResolveReviewResult> {
  return parseResolveReviewResult(
    await invokeEdgeJson('resolve-shipment-operation-review', {
      method: 'POST',
      body: { shipment_id: shipmentId, resolution, note },
    }),
  );
}
