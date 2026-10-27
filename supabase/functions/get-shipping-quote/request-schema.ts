import { z } from "../_shared/zod-runtime.ts";

export const ShippingQuoteRequestSchema = z.object({
  originZip: z.string().regex(/^\d{4,5}$/),
  packageId: z.string().trim().min(1).max(100),
  price: z.number().finite().positive(),
  destinationZip: z.string().regex(/^\d{4,5}$/).optional(),
});
