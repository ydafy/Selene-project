-- #293: the get-connect-earnings Edge Function was this view's only reader, and
-- no client called that function (#221 deleted the admin-web hook). The function
-- is deleted in the same change, so the view goes too. Nothing depends on it, so
-- no CASCADE; its grants go with it.
BEGIN;

DROP VIEW IF EXISTS public.admin_connect_earnings_view;

COMMIT;
