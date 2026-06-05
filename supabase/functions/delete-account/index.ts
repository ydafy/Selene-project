import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createClient,
  SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

type BlockedReason =
  | 'active_shipments'
  | 'active_orders'
  | 'open_disputes'
  | 'pending_payouts'
  | 'available_balance';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'delete-account',
      level,
      msg,
      ...data,
    }),
  );
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const blocked = (reason: BlockedReason) =>
  json(409, { error: 'DELETE_BLOCKED', blocked_reason: reason });

/**
 * Pre-check: any shipment owned by the seller that is NOT terminal.
 */
const checkActiveShipments = async (
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> => {
  const { count, error } = await admin
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', userId)
    .not('status', 'in', '(completed,cancelled,refunded)');

  if (error) throw new Error(`shipments check failed: ${error.message}`);
  return (count ?? 0) > 0;
};

/**
 * Pre-check: orders where user is buyer AND order not in terminal state.
 * The ON DELETE RESTRICT FK on orders.buyer_id blocks auth.user deletion
 * if the user is buyer on any non-terminal order.
 */
const checkActiveOrders = async (
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> => {
  const { count, error } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('buyer_id', userId)
    .not('status', 'in', '(completed,cancelled,refunded)');

  if (error) throw new Error(`orders check failed: ${error.message}`);
  return (count ?? 0) > 0;
};

/**
 * Pre-check: dispute opened by/against the user that is still open.
 * Disputes are linked through shipments + orders; we check either side.
 */
const checkActiveDisputes = async (
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> => {
  const { count, error } = await admin
    .from('disputes')
    .select('id', { count: 'exact', head: true })
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .not('status', 'in', '(resolved,rejected)');

  if (error) throw new Error(`disputes check failed: ${error.message}`);
  return (count ?? 0) > 0;
};

/**
 * Pre-check: payout requests in non-terminal state.
 */
const checkPendingPayouts = async (
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> => {
  const { count, error } = await admin
    .from('payout_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['pending', 'processing']);

  if (error) throw new Error(`payouts check failed: ${error.message}`);
  return (count ?? 0) > 0;
};

/**
 * Pre-check: wallet must be zeroed out (available + pending) before destructive delete.
 * pending_balance contains escrow funds — must be $0 to prevent trapped money.
 */
const checkAvailableBalance = async (
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> => {
  const { data, error } = await admin
    .from('wallets')
    .select('available_balance, pending_balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`wallet check failed: ${error.message}`);
  const available = data?.available_balance ?? 0;
  const pending = data?.pending_balance ?? 0;
  return available > 0 || pending > 0;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Authenticate via Bearer token.
    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );

    if (authError || !user) {
      return json(401, { error: 'UNAUTHORIZED' });
    }

    const userId = user.id;
    log('INFO', 'Delete-account requested', { userId });

    // 2. Pre-checks. Each blocker short-circuits with a 409.
    if (await checkActiveShipments(supabaseAdmin, userId)) {
      log('WARN', 'Blocked: active_shipments', { userId });
      return blocked('active_shipments');
    }
    if (await checkActiveOrders(supabaseAdmin, userId)) {
      log('WARN', 'Blocked: active_orders', { userId });
      return blocked('active_orders');
    }
    if (await checkActiveDisputes(supabaseAdmin, userId)) {
      log('WARN', 'Blocked: open_disputes', { userId });
      return blocked('open_disputes');
    }
    if (await checkPendingPayouts(supabaseAdmin, userId)) {
      log('WARN', 'Blocked: pending_payouts', { userId });
      return blocked('pending_payouts');
    }
    if (await checkAvailableBalance(supabaseAdmin, userId)) {
      log('WARN', 'Blocked: available_balance', { userId });
      return blocked('available_balance');
    }

    // 3. Stripe cleanup TODO guard — only run if a connect id exists.
    // Currently selects stripe_customer_id only; when Stripe Connect Express
    // migration lands, add stripe_connect_id to the select and call
    // stripe.accounts.del for connected accounts.
    const { data: priv } = await supabaseAdmin
      .from('profiles_private')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();

    if (priv?.stripe_customer_id) {
      // TODO: detach payment methods and remove customer when Stripe Connect
      // migration lands. Until then we log and continue — the auth deletion
      // is the source of truth for "account removed".
      log('INFO', 'Stripe customer present, deferred cleanup', {
        userId,
        stripe_customer_id: priv.stripe_customer_id,
      });
    }

    // 4. Destructive delete via auth admin API.
    const { error: deleteError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      log('ERROR', 'auth.admin.deleteUser failed', {
        userId,
        message: deleteError.message,
      });
      return json(500, {
        error: 'DELETE_FAILED',
        message: deleteError.message,
      });
    }

    log('INFO', 'Account deleted', { userId });
    return json(200, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    log('ERROR', 'Unexpected failure', { message });
    return json(500, { error: 'INTERNAL', message });
  }
});
