import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';

import { serveAdminWeb } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import { createGetSellerOnboardingHandler } from './handler.ts';

const handler = createGetSellerOnboardingHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
  createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) =>
    createClient(supabaseUrl, supabaseSecretKey),
});

serveAdminWeb(withSentry('get-seller-onboarding', handler));
