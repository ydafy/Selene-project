import { z } from '../_shared/zod-runtime.ts';

export const ManagePaymentMethodsRequestSchema = z.object({
  action: z.enum([
    'get_setup_config',
    'list_payment_methods',
    'delete_payment_method',
  ]),
  paymentMethodId: z.string().uuid().optional(),
});
