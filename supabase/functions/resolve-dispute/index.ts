import { createClient } from '../_shared/supabase-js.ts';

import { buildVerdictRpc } from './verdict-rpc.ts';
import { ResolveDisputeRequestSchema } from './request-schema.ts';
import { serveAdminWeb } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';

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

serveAdminWeb(
  withSentry('resolve-dispute', async (req) => {
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
        return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
          status: 401,
        });

      const { data: profile } = await supabaseAdmin
        .from('profiles_private')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role !== 'admin')
        return new Response(
          JSON.stringify({ error: 'Permisos insuficientes' }),
          {
            status: 403,
          },
        );

      // 2. Validar Payload
      const body = await req.json().catch(() => ({}));
      const { disputeId, verdict, adminNote } =
        ResolveDisputeRequestSchema.parse(body);

      log('INFO', 'Procesando veredicto', {
        disputeId,
        verdict,
        admin: user.id,
      });

      // 3. Ejecutar RPC correspondiente
      const rpc = buildVerdictRpc({ disputeId, verdict, adminNote }, user.id);

      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
        rpc.name,
        rpc.args,
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
      });
    } catch (caught) {
      const error = caught as Error;
      log('ERROR', 'Fallo en resolución', { error: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
      });
    }
  }),
);
