import { z } from 'zod';

export const addressSchema = z.object({
  full_name: z.string().min(3, 'address:errors.nameShort'),
  phone: z.string().regex(/^\d{10}$/, 'address:errors.phoneInvalid'),
  street_line1: z.string().min(5, 'address:errors.streetRequired'),
  street_number: z.string().trim().min(1, 'address:errors.streetNumberRequired'),

  street_line2: z
    .string()
    .nullish()
    .transform((val) => val ?? '')
    .pipe(z.string()),
  instructions: z
    .string()
    .nullish()
    .transform((val) => val ?? '')
    .pipe(z.string()),
  zip_code: z.string().regex(/^\d{5}$/, 'address:errors.zipInvalid'),
  state_code: z.string().min(2, 'address:errors.stateRequired'),
  city: z.string().min(2, 'address:errors.cityRequired'),
  district: z.string().min(1, 'address:errors.districtRequired'),
  label: z.string().min(1, 'address:errors.labelRequired'),
  is_default: z.boolean().default(false),
});

export type AddressFormData = z.infer<typeof addressSchema>;
