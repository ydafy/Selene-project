import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import { withSentry } from '../_shared/sentry.ts';
import {
  createGetShippingQuoteHandler,
  createShippingQuote,
} from './handler.ts';

const supabaseAuth = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  readSupabaseSecretKey() ?? '',
);

Deno.serve(
  withSentry(
    'get-shipping-quote',
    createGetShippingQuoteHandler({
      getUser: async (accessToken) => {
        const { data, error } = await supabaseAuth.auth.getUser(accessToken);
        return error || !data.user ? null : { id: data.user.id };
      },
      quote: createShippingQuote({
        getEnv: (name) => Deno.env.get(name),
        readSupabaseSecretKey,
        createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) =>
          createClient(supabaseUrl, supabaseSecretKey),
        fetch,
      }),
    }),
  ),
);
