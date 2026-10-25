import { z } from '../_shared/zod-runtime.ts';

export const ResolveDisputeRequestSchema = z.object({
  disputeId: z.string().uuid(),
  verdict: z.enum(['buyer', 'seller']),
  adminNote: z
    .string()
    .min(5, 'La nota del administrador es obligatoria y debe ser descriptiva'),
});
