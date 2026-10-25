import { z } from '../_shared/zod-runtime.ts';

export const RollbackConnectPaymentRequestSchema = z.object({
  orderId: z.string().min(1),
  paymentIntentIds: z.array(z.string().min(1)).min(1).max(20),
});
