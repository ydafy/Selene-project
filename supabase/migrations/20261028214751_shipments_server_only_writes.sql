-- Shipments are written only by server code: Edge Functions with the service role and
-- SECURITY DEFINER RPCs owned by postgres. No client (the Expo app, admin-web) writes the
-- table directly, so client roles keep SELECT and their read policies only.
--
-- The only SECURITY INVOKER function that updates shipments is fn_release_shipment_funds,
-- and neither anon nor authenticated can execute it, so no client-callable path loses a
-- privilege it needs.

DROP POLICY IF EXISTS "shipments_update_seller" ON public.shipments;
DROP POLICY IF EXISTS "shipments_update_admin" ON public.shipments;

-- Revoking the table privileges also revokes the matching column privileges.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.shipments FROM PUBLIC, anon, authenticated;
