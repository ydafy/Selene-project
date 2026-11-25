import { z } from '../_shared/zod-runtime.ts';

// The app's payment methods screen (Stripe CustomerSheet) asks for a session and,
// to add a card, a SetupIntent. Stripe owns the saved cards: no list or delete here.
export const ManagePaymentMethodsRequestSchema = z.object({
  action: z.enum(['create_customer_session', 'create_setup_intent']),
});
