import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';

import { withSentry } from '../_shared/sentry.ts';
import {
  createDeadline,
  createTrackShipmentsDependencies,
} from './dependencies.ts';
import { createTrackShipmentsHandler } from './handler.ts';

const handler = createTrackShipmentsHandler({
  secret: Deno.env.get('TRACK_SHIPMENTS_CRON_SECRET'),
  pollingEnabled: Deno.env.get('TRACK_SHIPMENTS_POLLING_ENABLED'),
  dependencies: createTrackShipmentsDependencies({
    createSupabaseAdmin: () =>
      createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        readSupabaseSecretKey() ?? '',
      ),
    getEnv: (name) => Deno.env.get(name),
    fetch,
    now: Date.now,
  }),
  now: () => new Date(),
  createDeadline,
});

Deno.serve(withSentry('track-shipments', handler));
