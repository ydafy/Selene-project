import { createClient } from '../_shared/supabase-js.ts';

import { withSentry } from '../_shared/sentry.ts';
import { createCompleteDeliveredShipmentsHandler } from './handler.ts';

const handler = createCompleteDeliveredShipmentsHandler({
  cronSecret: Deno.env.get('CRON_SECRET') ?? null,
  createSupabaseAdmin: () =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    ),
});

Deno.serve(withSentry('complete-delivered-shipments', handler));
