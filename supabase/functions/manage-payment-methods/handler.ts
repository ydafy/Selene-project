import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type Stripe from '../_shared/stripe/sdk.ts';
import {
  CUSTOMER_SESSION_FAILED,
  createCustomerSheetSession,
  stripeFailureReason,
  type CustomerSessionStripe,
} from '../_shared/stripe/customer-session.ts';

import { ManagePaymentMethodsRequestSchema } from './request-schema.ts';

export type SupabaseAdminClient = SupabaseClient;

// The Stripe calls this function makes; index.ts passes the real client.
export interface PaymentMethodsStripe extends CustomerSessionStripe {
  customers: {
    create: (params: Stripe.CustomerCreateParams) => Promise<{ id: string }>;
  };
  setupIntents: {
    create: (
      params: Stripe.SetupIntentCreateParams,
      options: { idempotencyKey: string },
    ) => Promise<{ client_secret: string | null }>;
  };
}

export interface ManagePaymentMethodsDependencies {
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Both are called once per request, before the Authorization header is read.
  createStripe: (stripeSecret: string) => PaymentMethodsStripe;
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
}

const APP_NAME = 'selene';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'manage-payment-methods',
      level,
      msg,
      ...data,
    }),
  );
};

// A missing or rejected token: the shared 401 contract of the user-token functions.
const authRequired = () =>
  new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

const SETUP_INTENT_FAILED = 'SETUP_INTENT_FAILED';

const json = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });

// A Stripe call the sheet cannot open without: 500 with a stable code, the
// Stripe message only in the log.
const stripeFailure = (code: string, caught: unknown) => {
  log('ERROR', 'Stripe call failed', {
    code,
    error: stripeFailureReason(caught),
  });
  return new Response(JSON.stringify({ error: code }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
};

export function createManagePaymentMethodsHandler(
  deps: ManagePaymentMethodsDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const stripe = deps.createStripe(deps.getEnv('STRIPE_SECRET_KEY') || '');

      const supabaseAdmin = deps.createSupabaseAdmin(
        deps.getEnv('SUPABASE_URL') ?? '',
        deps.readSupabaseSecretKey() ?? '',
      );

      // 1. Validar Identidad
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return authRequired();

      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) return authRequired();

      // 2. Validar Input
      const body = await req.json().catch(() => ({}));
      const { action } = ManagePaymentMethodsRequestSchema.parse(body);

      // 3. Asegurar Stripe Customer
      const { data: profile } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .single();
      let customerId = profile?.stripe_customer_id;

      if (!customerId) {
        log('INFO', 'Creando nuevo Stripe Customer', { userId: user.id });
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.id },
        });
        customerId = customer.id;
        await supabaseAdmin
          .from('profiles_private')
          .update({ stripe_customer_id: customerId })
          .eq('id', user.id);
      }

      // Stripe's CustomerSheet owns the saved cards: it lists and removes
      // them through the session and adds one by confirming the SetupIntent.
      // Selene keeps no copy and no card limit of its own.
      switch (action) {
        case 'create_customer_session': {
          let customerSessionClientSecret: string;
          try {
            customerSessionClientSecret = await createCustomerSheetSession(
              stripe,
              customerId,
            );
          } catch (caught) {
            return stripeFailure(CUSTOMER_SESSION_FAILED, caught);
          }
          return json({ customerId, customerSessionClientSecret });
        }

        case 'create_setup_intent': {
          let setupIntentClientSecret: string | null;
          try {
            ({ client_secret: setupIntentClientSecret } =
              await stripe.setupIntents.create(
                {
                  customer: customerId,
                  allowed_payment_method_types: ['card'],
                  // Selene charges a saved card only with the buyer in the
                  // sheet, never off-session.
                  usage: 'on_session',
                  metadata: { user_id: user.id, app_name: APP_NAME },
                },
                {
                  idempotencyKey:
                    req.headers.get('idempotency-key') || crypto.randomUUID(),
                },
              ));
          } catch (caught) {
            return stripeFailure(SETUP_INTENT_FAILED, caught);
          }
          if (!setupIntentClientSecret) {
            return stripeFailure(SETUP_INTENT_FAILED, 'no client secret');
          }
          return json({ setupIntentClientSecret });
        }

        default: {
          const unknownAction: never = action;
          throw new Error(`INVALID_ACTION: ${String(unknownAction)}`);
        }
      }
    } catch (caught) {
      const error = caught as Error;
      log('ERROR', 'Excepción en gestión de pagos', { error: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
