-- Remove API access to SECURITY DEFINER functions flagged by the Supabase
-- security advisor. Both functions inherited EXECUTE through the default PUBLIC
-- grant, so anon could call them through /rest/v1/rpc.
--
-- fn_reconcile_connect_payments: invoked only by the pg_cron job
-- `reconcile-connect-payments` (runs as the owner). As an API RPC it exposed
-- shipment ids and statuses without authentication.
--
-- fn_lock_product: admin-web product lock. The body already rejects callers
-- without a session or admin role; this removes the anon entry point.
--
-- is_admin() stays executable by PUBLIC on purpose: RLS policies granted to
-- PUBLIC call it, and it returns false for anonymous callers.
--
-- Privileges only; function bodies and data are unchanged.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.fn_reconcile_connect_payments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_reconcile_connect_payments() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_reconcile_connect_payments() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_connect_payments() TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_lock_product(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_lock_product(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_lock_product(uuid) TO authenticated, service_role;

COMMIT;
