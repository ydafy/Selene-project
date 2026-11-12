import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';

import { withSentry } from '../_shared/sentry.ts';
import { createConfirmShipmentDeliveryHandler } from './handler.ts';

const handler = createConfirmShipmentDeliveryHandler({
  createSupabaseAdmin: () =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      readSupabaseSecretKey() ?? '',
    ),
});

Deno.serve(withSentry('confirm-shipment-delivery', handler));
