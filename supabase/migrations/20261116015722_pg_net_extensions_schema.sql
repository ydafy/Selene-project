-- Move pg_net out of `public` (#312, advisor lint `extension_in_public`).
-- pg_net is not relocatable (ALTER EXTENSION ... SET SCHEMA fails), so it is
-- dropped and created again in `extensions`. Its functions and tables live in
-- its own `net` schema either way, so the cron commands that call
-- net.http_post do not change. Nothing depends on the extension (cron commands
-- are text); dropping it discards pending requests and the response history in
-- net._http_response, which only holds the last 6 hours.
--
-- Grant review (AGENTS.md): no privileges of ours change. Supabase's event
-- trigger issue_pg_net_access applies its default grants on `net` again when
-- the extension is created.

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;
COMMENT ON EXTENSION pg_net IS 'Async HTTP';
