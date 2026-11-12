import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { buildReturnShippingPaymentIntentParams } from './create-return-intent.ts';
import { ReturnIntentRequestSchema } from './request-schema.ts';

export type SupabaseAdminClient = SupabaseClient;
export type ReturnIntentStripeClient = Pick<
  Stripe,
  'ephemeralKeys' | 'paymentIntents'
>;

export interface CreateReturnIntentDependencies {
  // Read on every request: SUPABASE_URL and STRIPE_SECRET_KEY.
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Both called once per request, after the body is valid and before authentication.
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
  createStripe: (stripeSecret: string) => ReturnIntentStripeClient;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'create-return-intent',
      level,
      msg,
      ...data,
    }),
  );
};

export function createCreateReturnIntentHandler(
  deps: CreateReturnIntentDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const body = await req.json().catch(() => ({}));
      const { disputeId } = ReturnIntentRequestSchema.parse(body);

      const supabaseAdmin = deps.createSupabaseAdmin(
        deps.getEnv('SUPABASE_URL') ?? '',
        deps.readSupabaseSecretKey() ?? '',
      );

      const stripe = deps.createStripe(deps.getEnv('STRIPE_SECRET_KEY') || '');

      // 1. Autenticación
      const authHeader = req.headers.get('Authorization');
      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(
        authHeader?.replace('Bearer ', '') || '',
      );
      if (authError || !user) throw new ApiError(401, 'AUTH_REQUIRED');

      // 2. Fetch de Datos (Disputa + Settings)
      const [disputeRes, settingsRes] = await Promise.all([
        supabaseAdmin
          .from('disputes')
          .select('id, seller_id, status, order_id, shipment_id')
          .eq('id', disputeId)
          .single(),
        supabaseAdmin
          .from('system_settings')
          .select('return_label_fee_cents')
          .single(),
      ]);

      if (disputeRes.error || !disputeRes.data)
        throw new ApiError(404, 'Disputa no encontrada');
      const dispute = disputeRes.data;

      // 3. Validación centralizada via RPC (evita duplicar lógica)
      const { data: initResult, error: initError } = await supabaseAdmin.rpc(
        'fn_seller_initiate_return_label',
        {
          p_dispute_id: disputeId,
          p_caller_id: user.id,
        },
      );

      if (initError || !initResult?.[0]?.success) {
        const errMsg =
          initResult?.[0]?.error_message ||
          initError?.message ||
          'Operación no permitida';
        throw new ApiError(400, errMsg);
      }

      const returnFeeCents = settingsRes.data?.return_label_fee_cents || 30000; // Fallback $300

      if (!dispute.shipment_id) {
        throw new ApiError(400, 'Dispute is not linked to a shipment');
      }

      // 4. Load seller Stripe customer and connected account.
      const { data: profile } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_customer_id, stripe_account_id')
        .eq('id', dispute.seller_id)
        .single();
      if (!profile?.stripe_customer_id)
        throw new ApiError(
          400,
          'Seller does not have a Stripe customer configured',
        );
      if (!profile?.stripe_account_id)
        throw new ApiError(
          400,
          'Seller does not have a Stripe Connect account configured',
        );

      // 5. Generar Ephemeral Key y Payment Intent
      log('INFO', 'Creando Payment Intent para retorno', {
        disputeId,
        sellerId: dispute.seller_id,
        stripeAccountId: profile.stripe_account_id,
        amount: returnFeeCents,
      });

      const { params: paymentIntentParams, options: paymentIntentOptions } =
        buildReturnShippingPaymentIntentParams({
          amountCents: returnFeeCents,
          customerId: profile.stripe_customer_id,
          disputeId,
          orderId: dispute.order_id,
          sellerId: dispute.seller_id,
          shipmentId: dispute.shipment_id,
          stripeAccountId: profile.stripe_account_id,
        });

      const [ephemeralKey, paymentIntent] = await Promise.all([
        stripe.ephemeralKeys.create(
          { customer: profile.stripe_customer_id },
          { apiVersion: STRIPE_API_VERSION },
        ),
        stripe.paymentIntents.create(paymentIntentParams, paymentIntentOptions),
      ]);

      return new Response(
        JSON.stringify({
          clientSecret: paymentIntent.client_secret,
          ephemeralKey: ephemeralKey.secret,
          customer: profile.stripe_customer_id,
          amount: returnFeeCents / 100,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } catch (caught) {
      const error = caught as Error;
      const status = error instanceof ApiError ? error.status : 400;
      log('ERROR', 'Fallo al crear intent de retorno', {
        error: error.message,
      });
      return new Response(JSON.stringify({ error: error.message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
