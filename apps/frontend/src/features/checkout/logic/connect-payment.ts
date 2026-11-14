/**
 * @file apps/frontend/src/features/checkout/logic/connect-payment.ts
 * @description Checkout Connect response contracts and request builders.
 *
 * This module keeps the single-secret checkout contract aligned with the shared
 * `CreateConnectPaymentResponse` type and exposes the buyer-safe order summary
 * fee helper used by the checkout screen.
 *
 * @version 2.0
 * @domain frontend-checkout-utils
 */

import { z } from 'zod';
import type {
  CreateConnectPaymentResponse,
  EdgeFunctionRegistry,
} from '@selene/types';
import { grossUpDomesticMx } from '@/shared/utils/money/stripe-fee-gross-up';

type CartLikeItem = {
  id: string;
  seller_id?: string;
  price_cents?: number;
  shipping_cost_cents?: number;
  productId?: string;
  quantity?: 1;
};

const uniqueProductIds = (items: CartLikeItem[]) => {
  const seen = new Set<string>();
  const productIds: string[] = [];

  for (const item of items) {
    const productId = item.productId ?? item.id;
    if (!seen.has(productId)) {
      seen.add(productId);
      productIds.push(productId);
    }
  }

  return productIds;
};

export const ConnectPaymentResponseSchema = z.object({
  orderId: z.string(),
  customer: z.string(),
  ephemeralKey: z.string(),
  clientSecret: z.string(),
  amount: z.number(),
  transferGroup: z.string(),
});

export type ConnectPaymentResponse = CreateConnectPaymentResponse;

export interface NormalizedConnectPayment {
  orderId: string;
  customer: string;
  ephemeralKey: string;
  clientSecret: string;
  amount: number;
  transferGroup: string;
}

export function buildConnectPaymentRequest({
  items,
  addressId,
  idempotencyKey,
}: {
  items: CartLikeItem[];
  addressId: string;
  idempotencyKey?: string;
}): EdgeFunctionRegistry['create-connect-payment']['payload'] {
  const productIds = uniqueProductIds(items);

  return {
    items: productIds.map((productId) => ({ productId, quantity: 1 as const })),
    addressId,
    idempotencyKey,
  };
}

export function normalizeConnectPaymentResponse(
  response: ConnectPaymentResponse,
): NormalizedConnectPayment {
  const parsed = ConnectPaymentResponseSchema.parse(response);

  return {
    orderId: parsed.orderId,
    customer: parsed.customer,
    ephemeralKey: parsed.ephemeralKey,
    clientSecret: parsed.clientSecret,
    amount: parsed.amount,
    transferGroup: parsed.transferGroup,
  };
}

/** Seguro Selene in integer cents for a subtotal in integer cents. */
export function calculateSeguroSelene(subtotalCents: number): number {
  return grossUpDomesticMx(subtotalCents).seguroCents;
}

export function paymentIntentIdFromClientSecret(clientSecret: string): string {
  return clientSecret.split('_secret_')[0] ?? clientSecret;
}
