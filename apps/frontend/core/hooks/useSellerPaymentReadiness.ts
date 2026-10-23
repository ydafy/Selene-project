import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '../db/supabase';

/** Max ids accepted by fn_product_seller_payment_readiness per call. */
const RPC_MAX_IDS = 50;

const ReadinessRowsSchema = z.array(
  z.object({
    product_id: z.string(),
    seller_accepts_payments: z.boolean(),
  }),
);

export type SellerPaymentReadiness = Record<string, boolean>;

export const parseReadinessRows = (data: unknown): SellerPaymentReadiness =>
  Object.fromEntries(
    ReadinessRowsSchema.parse(data).map((row) => [
      row.product_id,
      row.seller_accepts_payments,
    ]),
  );

// The RPC is not in the generated Database types yet, so this is the single
// untyped call; the zod schema above restores the types for every caller.
const callReadinessRpc = async (ids: string[]): Promise<unknown> => {
  const { data, error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc('fn_product_seller_payment_readiness', { p_product_ids: ids });
  if (error) throw error;
  return data;
};

/**
 * Advisory pre-check. Never throws: on any failure it returns what it has so
 * the server gate (SELLER_NOT_ONBOARDED) decides. Ids omitted by the RPC are
 * not purchasable for other reasons and are simply absent from the map.
 */
export const fetchSellerPaymentReadiness = async (
  productIds: string[],
): Promise<SellerPaymentReadiness> => {
  const result: SellerPaymentReadiness = {};
  for (let i = 0; i < productIds.length; i += RPC_MAX_IDS) {
    try {
      const data = await callReadinessRpc(productIds.slice(i, i + RPC_MAX_IDS));
      Object.assign(result, parseReadinessRows(data));
    } catch (err) {
      console.warn(
        '[useSellerPaymentReadiness] check skipped:',
        err instanceof Error ? err.message : 'unknown',
      );
    }
  }
  return result;
};

/** Only an explicit `false` blocks; unknown never does. */
export const isSellerBlocked = (
  readiness: SellerPaymentReadiness | undefined,
  productId: string,
): boolean => readiness?.[productId] === false;

export const useSellerPaymentReadiness = (productIds: string[]) => {
  const key = [...productIds].sort();
  return useQuery({
    queryKey: ['seller-payment-readiness', key],
    queryFn: () => fetchSellerPaymentReadiness(key),
    enabled: key.length > 0,
    staleTime: 1000 * 30,
  });
};
