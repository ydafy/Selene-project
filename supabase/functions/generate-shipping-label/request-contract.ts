import { z } from '../_shared/zod-runtime.ts';

/** Must match the seller packing-evidence slots required by the prepare screen. */
export const REQUIRED_SHIPPING_EVIDENCE_IMAGES = 3;

const EVIDENCE_COUNT_MESSAGE = `Se requieren ${REQUIRED_SHIPPING_EVIDENCE_IMAGES} fotos de evidencia`;

const EVIDENCE_FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

/** True when `path` is exactly `shipments/<orderId>/<sellerId>/<file>` in the evidence bucket. */
export function isOwnShippingEvidencePath(
  path: string,
  orderId: string,
  sellerId: string,
): boolean {
  const prefix = `shipments/${orderId}/${sellerId}/`;
  if (!path.startsWith(prefix) || path.includes('..')) return false;
  return EVIDENCE_FILE_NAME.test(path.slice(prefix.length));
}

export const LabelRequestSchema = z.object({
  // guid() keeps the format-only identifier check this endpoint has always used.
  shipmentId: z.guid('ID de envío inválido'),
  originAddressId: z.guid('ID de origen inválido'),
  shippingEvidence: z.object({
    images: z
      .array(z.string().trim().min(1))
      .length(REQUIRED_SHIPPING_EVIDENCE_IMAGES, EVIDENCE_COUNT_MESSAGE)
      .refine((images) => new Set(images).size === images.length, {
        message: 'Las fotos de evidencia no pueden repetirse',
      }),
  }),
});
