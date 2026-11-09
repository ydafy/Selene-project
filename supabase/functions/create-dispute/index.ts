import { createClient } from '../_shared/supabase-js.ts';

import { withSentry } from '../_shared/sentry.ts';
import { createCreateDisputeHandler } from './handler.ts';

const handler = createCreateDisputeHandler({
  createSupabaseAdmin: () =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    ),
});

Deno.serve(withSentry('create-dispute', handler));
