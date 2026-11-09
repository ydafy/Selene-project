import { createClient } from '../_shared/supabase-js.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { ReconcileConnectPaymentsRequestSchema } from './request-schema.ts';
import { withSentry } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(
  withSentry('reconcile-connect-payments', async (req) => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      if (!stripeSecret || !serviceRoleKey || !supabaseUrl) {
        throw new Error('MISSING_SERVER_CONFIG');
      }

      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
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

      const stripe = new Stripe(stripeSecret, {
        apiVersion: STRIPE_API_VERSION,
        httpClient: Stripe.createFetchHttpClient(),
      });

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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }),
);
