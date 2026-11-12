import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type Stripe from '../_shared/stripe/sdk.ts';

import { ReconcileConnectPaymentsRequestSchema } from './request-schema.ts';

export type SupabaseAdminClient = SupabaseClient;
export type ReconcileStripeClient = Pick<Stripe, 'paymentIntents'>;

export interface ReconcileConnectPaymentsDependencies {
  // Read on every request: STRIPE_SECRET_KEY and SUPABASE_URL.
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Called once the server config is present.
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
  // Called after the admin check and a valid body.
  createStripe: (stripeSecret: string) => ReconcileStripeClient;
}

export function createReconcileConnectPaymentsHandler(
  deps: ReconcileConnectPaymentsDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const stripeSecret = deps.getEnv('STRIPE_SECRET_KEY');
      const supabaseSecretKey = deps.readSupabaseSecretKey();
      const supabaseUrl = deps.getEnv('SUPABASE_URL');
      if (!stripeSecret || !supabaseSecretKey || !supabaseUrl) {
        throw new Error('MISSING_SERVER_CONFIG');
      }

      const supabaseAdmin = deps.createSupabaseAdmin(
        supabaseUrl,
        supabaseSecretKey,
      );
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) throw new Error('AUTH_REQUIRED');

      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) throw new Error('AUTH_REQUIRED');

      const { data: profile } = await supabaseAdmin
        .from('profiles_private')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');

      const { paymentIntentIds } = ReconcileConnectPaymentsRequestSchema.parse(
        await req.json().catch(() => ({})),
      );

      const stripe = deps.createStripe(stripeSecret);

      const intents = paymentIntentIds?.length
        ? await Promise.all(
            paymentIntentIds.map((id) => stripe.paymentIntents.retrieve(id)),
          )
        : (
            await stripe.paymentIntents.search({
              query:
                "status:'succeeded' AND metadata['flow']:'connect_checkout'",
              limit: 50,
            })
          ).data;

      // The only target of this worker was the retired seller-grouped settlement
      // RPC. Do not replay those PaymentIntents into a grouped shipment model.
      const reconciled = 0;
      const skipped = intents.length;

      return new Response(
        JSON.stringify({
          success: true,
          reconciled,
          skipped,
          retired: 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        message === 'AUTH_REQUIRED'
          ? 401
          : message === 'ADMIN_REQUIRED'
            ? 403
            : 400;
      return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
