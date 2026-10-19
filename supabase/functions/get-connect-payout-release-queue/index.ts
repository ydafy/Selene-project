import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import {
  escapeIlikePattern,
  getQueueErrorStatus,
  type ConnectPayoutReleaseQueueRow,
} from './get-connect-payout-release-queue.ts';

import { createQueueHandler } from './handler.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') throw new Error('METHOD_NOT_ALLOWED');

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceRoleKey || !supabaseUrl)
      throw new Error('MISSING_SERVER_CONFIG');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED');

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return await createQueueHandler({
      getUser: async (token) => {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        return error ? null : user;
      },
      getProfile: async (id) => {
        const { data, error } = await supabaseAdmin.from('profiles_private')
          .select('role').eq('id', id).maybeSingle();
        if (error) throw new Error('PROFILE_LOOKUP_FAILED');
        return data;
      },
      rpc: async (args) => {
        const { data, error } = await supabaseAdmin.rpc('fn_get_admin_payout_queue', args);
        if (error) throw new Error('QUEUE_RPC_FAILED');
        return data;
      },
      legacy: async (search) => {
        let query = supabaseAdmin
          .from('admin_connect_payout_release_view')
          .select('*')
          .order('seller_name', { ascending: true })
          .order('completed_at', { ascending: true });

        if (search) {
          query = query.ilike('seller_name', `%${escapeIlikePattern(search)}%`);
        }

        const { data, error } = await query;
        if (error) throw new Error('RELEASE_QUEUE_LOOKUP_FAILED');
        return (data ?? []) as ConnectPayoutReleaseQueueRow[];
      },
    })(req);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      { success: false, error: message },
      getQueueErrorStatus(message),
    );
  }
});
