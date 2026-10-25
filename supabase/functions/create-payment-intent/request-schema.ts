import { z } from '../_shared/zod-runtime.ts';

export const CreatePaymentIntentRequestSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(50),
  addressId: z.string().uuid(),
  idempotencyKey: z.string().optional(),
});
