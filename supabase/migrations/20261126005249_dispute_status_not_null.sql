-- #59: the shipment completion guards rely on both columns.
-- A NULL dispute status matches neither side of `status NOT IN ('resolved', 'rejected')`,
-- so fn_release_shipment_funds and fn_confirm_shipment_delivery would complete a
-- shipment whose dispute is still open and make it payable.
ALTER TABLE "public"."disputes"
  ALTER COLUMN "status" SET NOT NULL;

-- Both functions treat any non-NULL stripe_payment_intent_id as a Stripe Connect
-- payment; only a PaymentIntent id (or NULL) is accepted.
ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_stripe_payment_intent_id_check" CHECK ((stripe_payment_intent_id ~ '^pi_\S+$'::text));
