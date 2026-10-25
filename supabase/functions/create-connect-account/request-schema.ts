import { z } from '../_shared/zod-runtime.ts';

export const CreateConnectAccountRequestSchema = z.object({
  // The client may still send Expo/app deep links for context. The resolver
  // never forwards raw client URLs to Stripe; it uses configured HTTPS URLs or
  // the HTTPS redirect bridge.
  refreshUrl: z.string().optional(),
  returnUrl: z.string().optional(),
});
