import type { ShippingEvidence } from '../../../packages/types/src/types.ts';

/** The value stored in `shipments.shipping_evidence`; admin-web reads its `images`. */
export function buildStoredShippingEvidence(
  images: string[],
): ShippingEvidence {
  return { images: [...images] };
}
