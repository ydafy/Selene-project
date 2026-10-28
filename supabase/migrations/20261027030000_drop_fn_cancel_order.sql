-- #39 (B5.7): drop the legacy fn_cancel_order. It cancelled a whole order and left its
-- shipments in 'paid', and nothing calls it: order cancellation goes through the
-- cancel-order Edge Function and the per-shipment fn_cancel_shipment.
--
-- Production check (Supabase MCP, 2026-10-26): one signature, fn_cancel_order(uuid, text, text);
-- no other public function body and no cron.job command references it; EXECUTE was granted to
-- service_role only. Plain DROP of that signature, no CASCADE: an unknown dependent object must
-- fail this migration instead of disappearing. IF EXISTS keeps a re-run safe.
-- The canonical file supabase/queries/orders/fn_cancel_order.sql is removed in the same change.
BEGIN;

DROP FUNCTION IF EXISTS public.fn_cancel_order(uuid, text, text);

COMMIT;
