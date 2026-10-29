import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { isActiveAdmin } from '../_shared/admin-auth.ts';
import { withSentry } from '../_shared/sentry.ts';
import { createResolveShipmentLabelReconciliationHandler } from './handler.ts';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'resolve-shipment-label-reconciliation',
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

const handler = createResolveShipmentLabelReconciliationHandler({
  getUserId: async (accessToken) => {
    const {
      data: { user },
      error,
    } = await getAdminClient().auth.getUser(accessToken);
    return error || !user ? null : user.id;
  },
  // Roles live in profiles_private.role, never in JWT claims.
  isAdmin: async (userId) => {
    const { data, error } = await getAdminClient()
      .from('profiles_private')
      .select('role, status')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return isActiveAdmin(data);
  },
  resolve: async (input) => {
    // The RPC is not in the generated types until `bun run db:types` runs after it is applied.
    const { data, error } = await getAdminClient().rpc(
      'fn_resolve_shipment_label_reconciliation' as never,
      {
        p_shipment_id: input.shipmentId,
        p_actor_id: input.adminId,
        p_resolution: input.resolution,
        p_note: input.note,
        p_envia_shipment_id: input.enviaShipmentId,
        p_tracking_number: input.trackingNumber,
        p_label_url: input.labelUrl,
        p_provider_cost_cents: input.providerCostCents,
      } as never,
    );
    return { data: data as unknown, error };
  },
  log,
});

serve(withSentry('resolve-shipment-label-reconciliation', handler));
