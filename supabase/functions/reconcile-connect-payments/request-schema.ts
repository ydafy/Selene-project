import { z } from '../_shared/zod-runtime.ts';

export const ReconcileConnectPaymentsRequestSchema = z.object({
  paymentIntentIds: z.array(z.string().min(1)).max(50).optional(),
});
