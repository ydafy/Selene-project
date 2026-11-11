import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { serveAdminWeb } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import {
  createAcknowledgeShipmentLateCarrierActivityHandler,
  createSupabaseAcknowledgeShipmentLateCarrierActivityPorts,
} from './handler.ts';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'acknowledge-shipment-late-carrier-activity',
      level,
      msg,
      ...data,
    }),
  );
};

// Lazy: a missing server config is a 500 for the request, not a crash at import time.
const getAdminClient = () => {
  const url = Deno.env.get('SUPABASE_URL');
  const supabaseSecretKey = readSupabaseSecretKey();
  if (!url || !supabaseSecretKey) throw new Error('MISSING_SERVER_CONFIG');
  return createClient<Database>(url, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const handler = createAcknowledgeShipmentLateCarrierActivityHandler({
  ...createSupabaseAcknowledgeShipmentLateCarrierActivityPorts(getAdminClient),
  log,
});

serveAdminWeb(
  withSentry('acknowledge-shipment-late-carrier-activity', handler),
);
