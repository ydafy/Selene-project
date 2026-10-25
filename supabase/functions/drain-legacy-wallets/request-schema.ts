import { z } from '../_shared/zod-runtime.ts';

export const DrainLegacyWalletsRequestSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});
