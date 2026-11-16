/**
 * @file supabase/functions/purge-old-evidence/index.ts
 *
 * Cron-invoked purge of evidence 120 days after its order closed (authenticated by
 * `x-cron-secret` against `CRON_SECRET`). See handler.ts.
 */
import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { reportMessage, withSentry } from '../_shared/sentry.ts';
import {
  createPurgeOldEvidenceHandler,
  createSupabasePurgeOldEvidencePorts,
} from './handler.ts';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'purge-old-evidence',
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

const handler = createPurgeOldEvidenceHandler({
  getCronSecret: () => Deno.env.get('CRON_SECRET'),
  ...createSupabasePurgeOldEvidencePorts({ getAdmin: getAdminClient }),
  log,
  reportMessage,
});

Deno.serve(withSentry('purge-old-evidence', handler));
