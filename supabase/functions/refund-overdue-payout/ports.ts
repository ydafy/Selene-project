/**
 * @file supabase/functions/refund-overdue-payout/ports.ts
 *
 * The real ports of handler.ts: the service-role Supabase client for auth, reads and the
 * service-only RPCs, and the Stripe client for the account, the charge and the refund.
 */

import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type Stripe from '../_shared/stripe/sdk.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { isActiveAdmin } from '../_shared/auth/admin-auth.ts';
import type { RefundOverduePayoutDeps } from './handler.ts';

type StripePorts = Pick<
  RefundOverduePayoutDeps,
  | 'retrieveAccount'
  | 'retrievePaymentIntent'
  | 'createRefund'
  | 'listRefunds'
  | 'retrieveRefund'
>;

export type RefundOverduePayoutStripe = Pick<
  Stripe,
  'accounts' | 'paymentIntents' | 'refunds'
>;

/** Stripe through the v1 API (accounts are read through v1, see `_shared/stripe/connect-status.ts`). */
export function createStripeRefundOverduePayoutPorts(
  getStripe: () => RefundOverduePayoutStripe,
): StripePorts {
  return {
    retrieveAccount: (accountId) => getStripe().accounts.retrieve(accountId),
    retrievePaymentIntent: (paymentIntentId) =>
      getStripe().paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      }),
    createRefund: (request, options) =>
      getStripe().refunds.create(request, options),
    // Every page, never a capped prefix: recovery decides "no refund exists" from this list.
    listRefunds: async (paymentIntentId) => {
      const refunds: Stripe.Refund[] = [];
      for await (const refund of getStripe().refunds.list({
        payment_intent: paymentIntentId,
        limit: 100,
      })) {
        refunds.push(refund);
      }
      return refunds;
    },
    retrieveRefund: (refundId) => getStripe().refunds.retrieve(refundId),
  };
}

const rpcResult = async (
  call: PromiseLike<{ data: unknown; error: { message: string } | null }>,
) => {
  const { data, error } = await call;
  return { data: data as unknown, error };
};

/**
 * The database ports, all through the service-role client: Supabase Auth resolves the token, the
 * `profiles_private` role and status decide the admin (never JWT claims), and service-only RPCs
 * do the work.
 */
export function createSupabaseRefundOverduePayoutPorts(
  getAdmin: () => SupabaseClient<Database>,
): Omit<
  RefundOverduePayoutDeps,
  keyof StripePorts | 'reportCritical' | 'log' | 'now'
> {
  return {
    getUserId: async (accessToken) => {
      const {
        data: { user },
        error,
      } = await getAdmin().auth.getUser(accessToken);
      return error || !user ? null : user.id;
    },
    isAdmin: async (userId) => {
      const { data, error } = await getAdmin()
        .from('profiles_private')
        .select('role, status')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return isActiveAdmin(data);
    },
    loadShipment: async (shipmentId) => {
      const { data, error } = await getAdmin()
        .from('admin_connect_payout_release_view')
        .select(
          'shipment_id, order_id, status, stripe_payment_intent_id, stripe_account_id, stripe_onboarding_status, is_payout_overdue',
        )
        .eq('shipment_id', shipmentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.shipment_id || !data.order_id) return null;
      return {
        shipment_id: data.shipment_id,
        order_id: data.order_id,
        status: data.status,
        stripe_payment_intent_id: data.stripe_payment_intent_id,
        stripe_account_id: data.stripe_account_id,
        stripe_onboarding_status: data.stripe_onboarding_status,
        is_payout_overdue: data.is_payout_overdue,
      };
    },
    loadStartedOperation: async (shipmentId) => {
      const { data, error } = await getAdmin().rpc(
        'fn_get_shipment_cancellation_recovery',
        { p_shipment_id: shipmentId },
      );
      if (error) throw new Error(error.message);
      return data as unknown;
    },
    loadOrder: async (orderId) => {
      const admin = getAdmin();
      const { data: order, error } = await admin
        .from('orders')
        .select('stripe_payment_intent_id, actual_stripe_fee_cents')
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!order) return null;
      const { data: items, error: itemsError } = await admin
        .from('order_items')
        .select('price_at_purchase_cents, shipping_amount_cents, shipment_id')
        .eq('order_id', orderId);
      if (itemsError) throw new Error(itemsError.message);
      return {
        stripe_payment_intent_id: order.stripe_payment_intent_id,
        actual_stripe_fee_cents: order.actual_stripe_fee_cents,
        items: items ?? [],
      };
    },
    saveActualStripeFee: async (orderId, feeCents, reconciledAt) => {
      const { error } = await getAdmin()
        .from('orders')
        .update({
          actual_stripe_fee_cents: feeCents,
          stripe_fee_reconciled_at: reconciledAt,
          updated_at: reconciledAt,
        })
        .eq('id', orderId)
        .is('actual_stripe_fee_cents', null);
      if (error) throw new Error(error.message);
    },
    claim: ({ adminId, shipmentId }) =>
      rpcResult(
        getAdmin().rpc('fn_claim_overdue_payout_refund', {
          p_admin_id: adminId,
          p_shipment_id: shipmentId,
        }),
      ),
    start: (input) =>
      rpcResult(
        getAdmin().rpc('fn_start_shipment_cancellation_refund', {
          p_shipment_id: input.shipmentId,
          p_claim_token: input.claimToken,
          p_refund_request: input.refundRequest as never,
          // Omitted means the SQL default, NULL: no reconciled Stripe fee to freeze.
          p_cancellation_loss_cents: input.cancellationLossCents ?? undefined,
        }),
      ),
    recordRefund: (input) =>
      rpcResult(
        getAdmin().rpc('fn_record_shipment_cancellation_refund', {
          p_shipment_id: input.shipmentId,
          p_refund_id: input.refundId,
          p_payment_intent_id: input.paymentIntentId,
          p_amount_cents: input.amountCents,
          p_status: input.status,
          p_failure_reason: input.failureReason ?? undefined,
        }),
      ),
    escalate: (shipmentId, reason) =>
      rpcResult(
        getAdmin().rpc('fn_escalate_shipment_cancellation', {
          p_shipment_id: shipmentId,
          p_reason: reason,
        }),
      ),
    leaseReplay: (shipmentId) =>
      rpcResult(
        getAdmin().rpc('fn_lease_overdue_refund_replay', {
          p_shipment_id: shipmentId,
        }),
      ),
    complete: (shipmentId) =>
      rpcResult(
        getAdmin().rpc('fn_complete_overdue_payout_refund', {
          p_shipment_id: shipmentId,
        }),
      ),
  };
}
