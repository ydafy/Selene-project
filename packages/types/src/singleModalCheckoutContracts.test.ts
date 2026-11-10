import type {
  CreateConnectPaymentResponse,
  ReleaseConnectPayoutResponse,
} from './index';

/**
 * Compile-time contract for the single-modal checkout and release responses.
 * `bun run typecheck` (`tsc --noEmit` on this package) is the gate: each
 * `satisfies` must hold and each `@ts-expect-error` must still be an error.
 *
 * The runtime behavior is tested where the responses are built and parsed:
 * - supabase/functions/create-connect-payment/single-payment-builder.test.ts
 *   (`buildCreateConnectPaymentResponse`);
 * - apps/frontend/src/features/checkout/logic/connect-payment.test.ts
 *   (`normalizeConnectPaymentResponse`).
 */

type ReleaseSuccess = Extract<ReleaseConnectPayoutResponse, { success: true }>;

export const singleSecretResponse = {
  orderId: 'o_1',
  clientSecret: 'pi_1_secret_1',
  customer: 'cus_1',
  ephemeralKey: 'ek_1',
  amount: 5000,
  transferGroup: 'selene_order_o_1',
} satisfies CreateConnectPaymentResponse;

export const legacyPerSellerResponse = {
  orderId: 'o_1',
  customer: 'cus_1',
  ephemeralKey: 'ek_1',
  // @ts-expect-error the per-seller paymentIntents[] shape is not the contract
  paymentIntents: [{ sellerId: 's_1', clientSecret: 'cs_1', amount: 2500 }],
} satisfies Partial<CreateConnectPaymentResponse>;

// @ts-expect-error transferGroup is required
export const responseWithoutTransferGroup: CreateConnectPaymentResponse = {
  orderId: 'o_1',
  clientSecret: 'pi_1_secret_1',
  customer: 'cus_1',
  ephemeralKey: 'ek_1',
  amount: 5000,
};

export const releaseWithTransfer = {
  success: true,
  runId: 'run_1',
  status: 'paid',
  amount: 470000,
  stripePayoutId: 'po_1',
  stripeTransferId: 'tr_1',
} satisfies ReleaseSuccess;

export const releaseWithoutTransfer = {
  success: true,
  runId: 'run_2',
  status: 'paid',
  amount: 100000,
} satisfies ReleaseSuccess;

export const releaseFailure = {
  success: false,
  error: 'insufficient balance',
  code: 'stripe_balance_insufficient',
} satisfies ReleaseConnectPayoutResponse;

// @ts-expect-error a failure response is not a release success
export const failureAsSuccess: ReleaseSuccess = releaseFailure;
