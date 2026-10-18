import { z } from '../_shared/zod-runtime.ts';

/** Must match the seller packing-evidence slots required by the prepare screen. */
export const REQUIRED_SHIPPING_EVIDENCE_IMAGES = 3;

const EVIDENCE_COUNT_MESSAGE = `Se requieren ${REQUIRED_SHIPPING_EVIDENCE_IMAGES} fotos de evidencia`;

export const LabelRequestSchema = z.object({
  // guid() keeps the format-only identifier check this endpoint has always used.
  shipmentId: z.guid('ID de envío inválido'),
  originAddressId: z.guid('ID de origen inválido'),
  shippingEvidence: z.object({
    images: z
      .array(z.string().url())
      .length(REQUIRED_SHIPPING_EVIDENCE_IMAGES, EVIDENCE_COUNT_MESSAGE)
      .refine((images) => new Set(images).size === images.length, {
        message: 'Las fotos de evidencia no pueden repetirse',
      }),
  }),
});
