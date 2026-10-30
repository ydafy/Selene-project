/**
 * @file supabase/functions/dispatch-push/index.ts
 *
 * Cron-invoked delivery of queued push notifications through the Expo Push API (every minute,
 * authenticated by `x-cron-secret` against `CRON_SECRET`). See handler.ts.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { reportMessage, withSentry } from '../_shared/sentry.ts';
import { createDispatchPushHandler, type ClaimedDelivery } from './handler.ts';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'dispatch-push',
      level,
      msg,
      ...data,
    }),
  );
};

// Lazy: a missing server config is a 500 for the request, not a crash at import time.
const getAdminClient = () => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('MISSING_SERVER_CONFIG');
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const handler = createDispatchPushHandler({
  getCronSecret: () => Deno.env.get('CRON_SECRET'),
  getExpoAccessToken: () => Deno.env.get('EXPO_ACCESS_TOKEN'),
  fetch,
  claimDeliveries: async (limit) => {
    const { data, error } = await getAdminClient().rpc(
      'fn_claim_push_deliveries',
      {
        p_limit: limit,
      },
    );
    return { data: data as ClaimedDelivery[] | null, error };
  },
  recordResults: async (results) =>
    await getAdminClient().rpc('fn_record_push_results', {
      p_results: results,
    }),
  listReceiptsDue: async (limit) =>
    await getAdminClient().rpc('fn_list_push_receipts_due', {
      p_limit: limit,
    }),
  recordReceipts: async (receipts) =>
    await getAdminClient().rpc('fn_record_push_receipts', {
      p_receipts: receipts,
    }),
  purgeDeliveries: async (limit) =>
    await getAdminClient().rpc('fn_purge_push_deliveries', {
      p_limit: limit,
    }),
  log,
  reportMessage,
});

serve(withSentry('dispatch-push', handler));
