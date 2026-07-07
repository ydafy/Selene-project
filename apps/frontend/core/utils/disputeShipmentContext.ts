import type { CreateDisputeRequest } from '@selene/types';

export const MISSING_SHIPMENT_CONTEXT_ERROR =
  'Missing shipment context. Please start the report from a shipment.';

type SearchParam = string | string[] | undefined;

export type OpenDisputeParams = {
  shipmentId: string;
  reason: string;
  description: string;
  images: string[];
  checklist: Record<string, boolean>;
  videoUrl: string | null;
};

export function resolveShipmentContext(
  shipmentIdParam: SearchParam,
): { shipmentId: string } | { error: string } {
  if (typeof shipmentIdParam !== 'string' || shipmentIdParam.trim().length === 0) {
    return { error: MISSING_SHIPMENT_CONTEXT_ERROR };
  }

  return { shipmentId: shipmentIdParam };
}

export function buildOpenDisputeRequest(
  orderId: string,
  params: OpenDisputeParams,
): CreateDisputeRequest {
  return {
    orderId,
    shipmentId: params.shipmentId,
    reason: params.reason,
    description: params.description,
    evidence: {
      images: params.images,
      tech_checklist: params.checklist,
      video_url: params.videoUrl,
    },
  };
}

export function getOpenDisputeInvalidationKeys(
  orderId: string,
  shipmentId: string,
): readonly (readonly string[])[] {
  return [
    ['order', orderId],
    ['shipments', orderId],
    ['shipment', shipmentId],
    ['disputes', orderId],
    ['my-purchases'],
  ];
}
