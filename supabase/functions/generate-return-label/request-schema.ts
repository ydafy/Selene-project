import { z } from '../_shared/zod-runtime.ts';

export const ReturnLabelRequestSchema = z.object({
  disputeId: z.string().uuid('ID de disputa inválido'),
});
