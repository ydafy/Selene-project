/**
 * @file core/schemas/sell.schema.ts
 * @description Única Fuente de la Verdad (SSOT) para la validación de productos en Selene.
 */

import { z } from 'zod';
import { ProductCategory, ShippingPayer } from '@selene/types';

export const productCategories: [ProductCategory, ...ProductCategory[]] = [
  'GPU',
  'CPU',
  'Motherboard',
  'RAM',
];

export const shippingPayers: [ShippingPayer, ...ShippingPayer[]] = [
  'seller',
  'buyer',
];

// --- 1. ESQUEMA MAESTRO (Validación Final de Publicación) ---
export const publishProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre del producto es obligatorio.')
    .min(10, 'El título debe tener al menos 10 caracteres.')
    .max(80, 'El título no puede superar los 80 caracteres.'),

  description: z
    .string()
    .min(20, 'Descripción de al menos 20 caracteres.')
    .max(1500, 'La descripción no puede superar los 1500 caracteres.'),

  price: z
    .string()
    .min(1, 'Ingresa un precio válido.')
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 10, {
      message: 'El precio mínimo de venta en Selene es de $10 MXN.',
    })
    .refine((val) => Number(val) <= 500000, {
      message: 'El precio no puede superar los $500,000 MXN.',
    }),

  category: z.enum(productCategories, {
    message: 'Debes seleccionar una categoría válida.',
  }),

  condition: z.string().min(1, 'Selecciona la condición del producto.'),

  usage: z.string().min(1, 'Selecciona el tiempo de uso del componente.'),

  origin_zip: z
    .string()
    .regex(/^\d{5}$/, 'El código postal debe ser de 5 dígitos numéricos.'),

  package_preset: z.string().min(1, 'El paquete de envío es obligatorio.'),

  shipping_payer: z.enum(shippingPayers),

  insurance_enabled: z.boolean(),

  shipping_cost: z
    .string()
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 0, {
      message: 'El costo de envío debe ser un valor válido.',
    }),

  images: z
    .array(z.string())
    .min(1, 'Debes subir al menos 1 foto real de tu producto.')
    .max(5, 'Puedes subir un máximo de 5 fotos.'),

  specifications: z.record(z.string(), z.unknown()),
});

// --- 2. ESQUEMA DEL PASO DE DETALLES (Derivado con .pick) ---
export const sellDetailsSchema = publishProductSchema.pick({
  name: true,
  price: true,
  condition: true,
  usage: true,
  description: true,
  origin_zip: true,
  package_preset: true,
  shipping_payer: true,
  insurance_enabled: true,
});

export type PublishProductInput = z.infer<typeof publishProductSchema>;
export type SellDetailsInput = z.infer<typeof sellDetailsSchema>;
