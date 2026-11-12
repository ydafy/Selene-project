import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type Stripe from '../_shared/stripe/sdk.ts';

import {
  extractProductIdsFromIntentMetadata,
  mergeUniqueProductIds,
} from './rollback-connect-payment.ts';
import { RollbackConnectPaymentRequestSchema } from './request-schema.ts';

export type SupabaseAdminClient = SupabaseClient;
export type RollbackStripeClient = Pick<Stripe, 'paymentIntents'>;

// Rollback only aborts intents that were never charged. A succeeded intent is
// settled by the payment_intent.succeeded webhook (stripe-webhooks) or, when the
// order fails to settle, refunded by checkout-recovery-worker.
const CANCELLABLE_STATUSES: ReadonlySet<string> = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

export interface RollbackConnectPaymentDependencies {
  // Read on every request: STRIPE_SECRET_KEY and SUPABASE_URL.
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Called after the server config is present and an Authorization header was sent.
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
  // Called after the caller is authenticated and the body is valid.
  createStripe: (stripeSecret: string) => RollbackStripeClient;
}

const log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'rollback-connect-payment',
      level,
      msg,
      ...meta,
    }),
  );
};

export function createRollbackConnectPaymentHandler(
  deps: RollbackConnectPaymentDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const stripeSecret = deps.getEnv('STRIPE_SECRET_KEY');
      const supabaseSecretKey = deps.readSupabaseSecretKey();
      const supabaseUrl = deps.getEnv('SUPABASE_URL');
      if (!stripeSecret || !supabaseSecretKey || !supabaseUrl) {
        throw new Error('MISSING_SERVER_CONFIG');
      }

      const authHeader = req.headers.get('Authorization');
      if (!authHeader) throw new Error('AUTH_REQUIRED');

      const supabaseAdmin = deps.createSupabaseAdmin(
        supabaseUrl,
        supabaseSecretKey,
      );
      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) throw new Error('AUTH_REQUIRED');

      const { orderId, paymentIntentIds } =
        RollbackConnectPaymentRequestSchema.parse(
          await req.json().catch(() => ({})),
        );

      const stripe = deps.createStripe(stripeSecret);

      const intents: Array<{
        paymentIntentId: string;
        intent: Stripe.PaymentIntent;
        productIds: string[];
      }> = [];

      // Every intent is checked before any cancel or release, so a refused
      // request does no partial work.
      for (const paymentIntentId of paymentIntentIds) {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.metadata?.buyer_id !== user.id) {
          throw new Error('PAYMENT_INTENT_NOT_OWNED_BY_USER');
        }
        if (intent.metadata?.order_id !== orderId) {
          throw new Error('PAYMENT_INTENT_ORDER_MISMATCH');
        }

        const parsedProductIds = extractProductIdsFromIntentMetadata(
          intent.metadata,
        );
        if (parsedProductIds.malformed) {
          log('warn', 'Malformed product metadata skipped', {
            paymentIntentId,
          });
        }

        intents.push({
          paymentIntentId,
          intent,
          productIds: parsedProductIds.productIds,
        });
      }

      let rolledBack = 0;
      let productIdsToRelease: string[] = [];
      for (const { paymentIntentId, intent, productIds } of intents) {
        if (!CANCELLABLE_STATUSES.has(intent.status)) continue;
        await stripe.paymentIntents.cancel(paymentIntentId);
        rolledBack += 1;
        productIdsToRelease = mergeUniqueProductIds(
          productIdsToRelease,
          productIds,
        );
      }

      if (productIdsToRelease.length > 0) {
        const { data, error } = await supabaseAdmin.rpc('fn_release_products', {
          p_product_ids: productIdsToRelease,
        });

        if (error) {
          log('error', 'Product release failed after Stripe rollback', {
            orderId,
            productIds: productIdsToRelease,
            error: error.message,
          });
        } else if (
          Array.isArray(data) &&
          data.some((row) => row && row.success === false)
        ) {
          log('error', 'Product release returned unsuccessful result', {
            orderId,
            productIds: productIdsToRelease,
            data,
          });
        } else {
          log('info', 'Reserved products released after Stripe rollback', {
            orderId,
            productIds: productIdsToRelease,
          });
        }
      }

      return new Response(JSON.stringify({ success: true, rolledBack }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({ success: false, rolledBack: 0, error: message }),
        {
          status: message === 'AUTH_REQUIRED' ? 401 : 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  };
}
