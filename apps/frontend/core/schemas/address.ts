import { z } from 'zod';

export const addressSchema = z.object({
  full_name: z.string().min(3, 'Requerido'),
  phone: z.string().min(10, 'Teléfono inválido (10 dígitos)'),
  street_line1: z.string().min(5, 'Dirección requerida'),
  street_line2: z.string().optional(),
  instructions: z.string().optional(),
  zip_code: z.string().min(5, 'CP Requerido'),
  state: z.string().min(2, 'Estado requerido'),
  city: z.string().min(2, 'Ciudad requerida'),
  label: z.string().min(1, 'Requerido'),
});

export type AddressFormData = z.infer<typeof addressSchema>;
