import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'resolve-dispute',
      level,
      msg,
      ...data,
    }),
  );
};

const RequestSchema = z.object({
  disputeId: z.string().uuid(),
  verdict: z.enum(['buyer', 'seller']),
  adminNote: z
    .string()
    .min(5, 'La nota del administrador es obligatoria y debe ser descriptiva'),
});

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Validar Admin
    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );
    if (authError || !user)
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: corsHeaders,
      });

    const { data: profile } = await supabaseAdmin
      .from('profiles_private')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin')
      return new Response(JSON.stringify({ error: 'Permisos insuficientes' }), {
        status: 403,
        headers: corsHeaders,
      });

    // 2. Validar Payload
    const body = await req.json().catch(() => ({}));
    const { disputeId, verdict, adminNote } = RequestSchema.parse(body);

    log('INFO', 'Procesando veredicto', { disputeId, verdict, admin: user.id });

    // 3. Ejecutar RPC correspondiente
    const rpcName =
      verdict === 'seller'
        ? 'fn_resolve_dispute_to_seller'
        : 'fn_resolve_dispute_to_buyer';

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      rpcName,
      {
        p_dispute_id: disputeId,
        p_admin_note: adminNote,
      },
    );

    if (rpcError || (rpcData && !rpcData[0]?.success)) {
      throw new Error(
        rpcError?.message ||
          rpcData?.[0]?.error_message ||
          'Error en la base de datos',
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error: any) {
    log('ERROR', 'Fallo en resolución', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
