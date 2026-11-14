CREATE TABLE "public"."orders" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"               timestamp with time zone DEFAULT now(),
  "buyer_id"                 uuid                     NOT NULL,
  "total_amount_cents"       bigint                   NOT NULL,
  "stripe_payment_intent_id" text,
  "shipping_address"         jsonb                    NOT NULL,
  "service_fee_amount_cents" bigint                   NOT NULL DEFAULT 0,
  "currency"                 text                     DEFAULT 'MXN'::text,
  CONSTRAINT "orders_service_fee_amount_cents_check" CHECK ((service_fee_amount_cents >= 0)),
  CONSTRAINT "orders_total_amount_cents_check" CHECK ((total_amount_cents >= 0)),
  CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY (buyer_id) REFERENCES auth.users(id),
  CONSTRAINT "orders_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."orders"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."orders"
  ADD COLUMN "status" public.order_status_enum NOT NULL DEFAULT 'pending'::public.order_status_enum;

ALTER TABLE "public"."orders"
  ADD COLUMN "delivered_at" timestamp WITH time zone;

ALTER TABLE "public"."orders"
  ADD COLUMN "updated_at" timestamp WITH time zone DEFAULT timezone('utc'::text, now());

ALTER TABLE "public"."orders"
  ADD COLUMN "completed_at" timestamp WITH time zone;

ALTER TABLE "public"."orders"
  ADD COLUMN "stripe_charge_id" text;

ALTER TABLE "public"."orders"
  ADD COLUMN "stripe_transfer_group" text;

ALTER TABLE "public"."orders"
  ADD COLUMN "payment_processing" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."orders"
  ADD COLUMN "payment_processing_reason" text;

ALTER TABLE "public"."orders"
  ADD COLUMN "actual_stripe_fee_cents" bigint;

ALTER TABLE "public"."orders"
  ADD COLUMN "stripe_fee_reconciled_at" timestamp WITH time zone;

ALTER TABLE "public"."orders"
  ADD COLUMN "cancellation_loss_cents" bigint;

ALTER TABLE "public"."orders"
  ADD COLUMN "compensation_state" text;

ALTER TABLE "public"."orders"
  ADD COLUMN "compensation_attempt_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."orders"
  ADD COLUMN "next_compensation_retry_at" timestamp WITH time zone;

ALTER TABLE "public"."orders"
  ADD COLUMN "compensation_lease_expires_at" timestamp WITH time zone;

ALTER TABLE "public"."orders"
  ADD COLUMN "stripe_refund_id" text;

ALTER TABLE "public"."orders"
  ADD COLUMN "compensation_last_error" text;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_compensation_state_check"
    CHECK (((compensation_state IS NULL) OR (compensation_state = ANY (ARRAY['refund_pending'::text, 'refunding'::text, 'refund_failed_retry_queued'::text, 'refunded'::text, 'reconciliation_needed'::text]))));

CREATE INDEX idx_orders_delivered_at ON public.orders USING btree (delivered_at)
  WHERE (status = 'delivered'::public.order_status_enum);

CREATE INDEX idx_orders_payment_processing ON public.orders USING btree (payment_processing)
  WHERE (payment_processing = true);

CREATE INDEX idx_orders_status ON public.orders USING btree (status);

CREATE INDEX idx_orders_stripe_charge_id ON public.orders USING btree (stripe_charge_id)
  WHERE (stripe_charge_id IS NOT NULL);

CREATE UNIQUE INDEX idx_orders_stripe_transfer_group_unique ON public.orders USING btree (stripe_transfer_group)
  WHERE (stripe_transfer_group IS NOT NULL);

CREATE INDEX idx_orders_stripe_transfer_group ON public.orders USING btree (stripe_transfer_group)
  WHERE (stripe_transfer_group IS NOT NULL);

CREATE INDEX ix_orders_buyer_id ON public.orders USING btree (buyer_id);

CREATE INDEX orders_checkout_recovery_claim_idx ON public.orders USING btree (next_compensation_retry_at, created_at)
  WHERE ((payment_processing = true) AND (compensation_state = ANY (ARRAY['refund_pending'::text, 'refund_failed_retry_queued'::text, 'refunding'::text])));

CREATE UNIQUE INDEX orders_stripe_payment_intent_id_recovery_uidx ON public.orders USING btree (stripe_payment_intent_id)
  WHERE (stripe_payment_intent_id IS NOT NULL);

CREATE TRIGGER tr_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "orders_select_v4" ON "public"."orders"
  FOR SELECT
  TO PUBLIC
  USING ((( SELECT public.is_admin() AS is_admin) OR internal.fn_check_order_access(id, ( SELECT auth.uid() AS uid))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "service_role";

COMMENT ON COLUMN "public"."orders"."payment_processing" IS 'True when the platform payment succeeded but order/shipment/allocation persistence failed and is pending ops recovery. Keeps status=pending until durable.';

COMMENT ON COLUMN "public"."orders"."payment_processing_reason" IS 'Human-readable reason for the current payment_processing recovery state. NULL when payment_processing=false.';

COMMENT ON COLUMN "public"."orders"."service_fee_amount_cents" IS 'Sum of the Selene commission of every shipment in the order, in integer cents.';

COMMENT ON COLUMN "public"."orders"."stripe_charge_id" IS 'Stripe Charge ID captured from the platform PaymentIntent on payment success. NULL until the webhook persists it.';

COMMENT ON COLUMN "public"."orders"."stripe_payment_intent_id" IS 'Single PaymentIntent ID for legacy wallet-era orders. NULL for Connect-era orders (see shipments.stripe_payment_intent_id per shipment).';

COMMENT ON COLUMN "public"."orders"."stripe_transfer_group" IS 'Stripe transfer_group used to group per-shipment platform->seller Transfers on manual release. NULL for legacy per-seller orders.';

COMMENT ON COLUMN "public"."orders"."total_amount_cents" IS 'Amount the buyer paid for the order, in integer cents.';

REVOKE ALL ON TABLE "public"."orders" FROM "anon";

REVOKE ALL ON TABLE "public"."orders" FROM "authenticated";

GRANT SELECT ON TABLE "public"."orders" TO "authenticated";

REVOKE ALL ON TABLE "public"."orders" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "postgres";
