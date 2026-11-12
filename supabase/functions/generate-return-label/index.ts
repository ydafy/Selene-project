import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';

import { withSentry } from '../_shared/sentry.ts';
import { createGenerateReturnLabelHandler } from './handler.ts';

const handler = createGenerateReturnLabelHandler({
  createSupabaseAdmin: () =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      readSupabaseSecretKey() ?? '',
    ),
  getEnv: (name) => Deno.env.get(name),
  fetch,
});

Deno.serve(withSentry('generate-return-label', handler));
