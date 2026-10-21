/**
 * @file supabase/functions/cron-watchdog/index.ts
 *
 * Cron-invoked watchdog (every 15 minutes, authenticated by `x-cron-secret`).
 * Reads pg_cron health through `fn_cron_health()` and reports each unhealthy job
 * to Sentry as an error. The run itself is a Sentry Cron Monitor, so a missed
 * or failed watchdog run alerts too. See odd/tasks/sentry-observability.md (L12).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import { reportMessage, withMonitor, withSentry } from '../_shared/sentry.ts';
import { createCronWatchdogHandler } from './handler.ts';
import type { CronHealthRow } from './health.ts';

const MONITOR_SLUG = 'cron-watchdog';
const MONITOR_CONFIG = {
  schedule: { type: 'crontab' as const, value: '*/15 * * * *' },
  checkinMargin: 5,
  maxRuntime: 5,
  timezone: 'UTC',
};

const handler = createCronWatchdogHandler({
  getCronSecret: () => Deno.env.get('CRON_SECRET'),
  now: () => new Date(),
  fetchCronHealth: async () => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return { data: null, error: { message: 'MISSING_SERVER_CONFIG' } };
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabaseAdmin.rpc('fn_cron_health');
    return { data: (data as CronHealthRow[] | null) ?? null, error };
  },
  reportMessage,
  runMonitored: (fn) => withMonitor(MONITOR_SLUG, MONITOR_CONFIG, fn),
  log: (message) => console.error(message),
});

serve(withSentry('cron-watchdog', handler));
