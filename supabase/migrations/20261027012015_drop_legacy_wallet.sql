-- remove-legacy-wallet T6 (S2, S3): drop the wallet, its functions, the views that
-- read it and the connect_enabled switch. All data is simulated (L1, L3), so nothing
-- is kept. Plain DROP in dependency order, no CASCADE: an unknown dependency must
-- fail this migration instead of disappearing silently.
--
-- Production dependencies (Supabase MCP, 2026-10-26): functions fn_request_payout and
-- fn_save_bank_account; views admin_payments_overview and admin_user_directory_view;
-- enum wallet_transaction_type; foreign keys only among the wallet tables and to
-- profiles, orders, shipments and auth.users; no triggers, no cron jobs.
-- fn_release_shipment_funds stays: fn_cron_dispute_shipping_timeout still calls it.
BEGIN;

-- 1. Functions. fn_cron_release_shipment_funds only served legacy non-Connect
-- shipments and has no schedule; its Edge Function release-funds is deleted too.
DROP FUNCTION public.fn_request_payout(numeric, uuid);
DROP FUNCTION public.fn_save_bank_account(text, text);
DROP FUNCTION internal.fn_save_bank_account(text, text);
DROP FUNCTION public.fn_cron_release_shipment_funds();

-- 2. Views.
DROP VIEW public.admin_payments_overview;

-- Columns are removed, so the view is dropped and created again.
DROP VIEW public.admin_user_directory_view;

CREATE VIEW public.admin_user_directory_view
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.username,
  pp.email,
  p.avatar_url,
  pp.role,
  pp.status,
  p.is_verified_seller,
  p.created_at
FROM public.profiles p
LEFT JOIN public.profiles_private pp ON p.id = pp.id;

ALTER VIEW public.admin_user_directory_view OWNER TO postgres;

-- Grants are unchanged from before this migration (production ACL: postgres, anon,
-- authenticated and service_role all hold arwdDxtm). They stay broad on purpose:
-- security_invoker = true makes the base tables' RLS apply to the caller, so anon
-- and authenticated see only what profiles and profiles_private policies allow.
GRANT ALL ON TABLE public.admin_user_directory_view TO anon;
GRANT ALL ON TABLE public.admin_user_directory_view TO authenticated;
GRANT ALL ON TABLE public.admin_user_directory_view TO service_role;

-- 3. Tables, children first.
DROP TABLE public.payout_requests;
DROP TABLE public.wallet_transactions;
DROP TABLE public.wallets;
DROP TABLE public.seller_bank_accounts;
DROP TABLE public.mexico_banks;

-- 4. The enum was only used by wallet_transactions.type.
DROP TYPE public.wallet_transaction_type;

-- 5. connect_enabled: nothing reads it after fn_request_payout and
-- drain-legacy-wallets are gone.
ALTER TABLE public.system_settings DROP COLUMN connect_enabled;

COMMIT;
