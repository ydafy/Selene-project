import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RequestSchema = z.object({
  search: z.string().trim().max(120).optional(),
});

const escapeIlikePattern = (value: string) =>
  value.replace(/[\\%_]/g, (match) => `\\${match}`);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceRoleKey || !supabaseUrl) {
      throw new Error('MISSING_SERVER_CONFIG');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('AUTH_REQUIRED');

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    const { data: profile } = await supabaseAdmin
      .from('profiles_private')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');

    const { search } = RequestSchema.parse(await req.json().catch(() => ({})));

    let query = supabaseAdmin
      .from('admin_connect_earnings_view')
      .select('*')
      .order('created_at', { ascending: false });

    if (search) {
      query = query.ilike('seller_name', `%${escapeIlikePattern(search)}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, rows: data ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === 'AUTH_REQUIRED'
        ? 401
        : message === 'ADMIN_REQUIRED'
          ? 403
          : 400;

    return new Response(JSON.stringify({ success: false, error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
