-- Remove two Dashboard-created objects that stored secrets in plaintext in the
-- schema. Neither is referenced by application code.
--
-- tr_webhook_order_completed: on every order completion it POSTed to the Edge
-- Function `order-automation`, which is not deployed, with a hardcoded
-- service_role JWT in the Authorization header.
--
-- stripe_server / stripe_wrapper: a Stripe foreign data wrapper whose server
-- options held a Stripe secret key. Its foreign tables in schema `stripe`
-- (customers, payment_intents, charges) are unused; Edge Functions call Stripe
-- through the SDK. The `wrappers` extension itself stays installed.
--
-- Drops are not cascading: if an unexpected dependency exists, this migration
-- must fail instead of dropping it silently. No data is changed.
BEGIN;

DROP TRIGGER IF EXISTS tr_webhook_order_completed ON public.orders;

DROP FOREIGN TABLE IF EXISTS stripe.customers;
DROP FOREIGN TABLE IF EXISTS stripe.payment_intents;
DROP FOREIGN TABLE IF EXISTS stripe.charges;
DROP SERVER IF EXISTS stripe_server;
DROP FOREIGN DATA WRAPPER IF EXISTS stripe_wrapper;
DROP SCHEMA IF EXISTS stripe;

COMMIT;
