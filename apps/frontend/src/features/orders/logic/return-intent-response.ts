import { z } from 'zod';

// `create-return-intent` gives PaymentSheet a CustomerSession for the buyer's
// Stripe customer, so the sheet shows, saves and removes saved cards (S7a).
const ReturnIntentResponseSchema = z.object({
  clientSecret: z.string().min(1),
  customer: z.string().min(1),
  customerSessionClientSecret: z.string().min(1),
});

export interface ReturnPaymentSheetSecrets {
  paymentIntentClientSecret: string;
  customerId: string;
  customerSessionClientSecret: string;
}

export function parseReturnIntentResponse(
  response: unknown,
): ReturnPaymentSheetSecrets {
  const parsed = ReturnIntentResponseSchema.parse(response);

  return {
    paymentIntentClientSecret: parsed.clientSecret,
    customerId: parsed.customer,
    customerSessionClientSecret: parsed.customerSessionClientSecret,
  };
}
