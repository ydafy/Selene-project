/**
 * @file core/schemas/checkout.schema.ts
 * @description Esquema de validación estricto para el checkout de Selene (Sintaxis Universal Zod).
 */

import { z } from 'zod';

export const checkoutValidationSchema = z.object({
  addressId: z
    .string()
    .min(1, 'Debes seleccionar una dirección de entrega.')
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'Dirección de entrega inválida.',
    ),

  paymentMethodId: z.string().min(1, 'Debes seleccionar un método de pago.'),

  isTermsAccepted: z.boolean().refine((val) => val === true, {
    message: 'Debes aceptar los términos y condiciones de compra.',
  }),
});

export type CheckoutValidationInput = z.infer<typeof checkoutValidationSchema>;
