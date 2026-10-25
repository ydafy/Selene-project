import { z } from '../_shared/zod-runtime.ts';

export const ShipmentTrackingUrlRequestSchema = z.object({
  shipmentId: z.string().uuid(),
});
