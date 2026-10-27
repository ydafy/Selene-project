import { z } from '../_shared/zod-runtime.ts';

export const ConnectEarningsRequestSchema = z.object({
  search: z.string().trim().max(120).optional(),
});
