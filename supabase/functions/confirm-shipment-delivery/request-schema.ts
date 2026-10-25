import { z } from '../_shared/zod-runtime.ts';

export const ConfirmationRequestSchema = z
  .object({
    orderId: z.string().uuid(),
    shipmentId: z.string().uuid(),
    idempotencyKey: z.string().min(1),
  })
  .strict()
  .refine(
    (request) =>
      request.idempotencyKey === `confirm_shipment_${request.shipmentId}`,
    { path: ['idempotencyKey'], message: 'Invalid idempotency key' },
  );
