CREATE TABLE "public"."shipments" (
  "id"        uuid NOT NULL DEFAULT gen_random_uuid(),
  "order_id"  uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT,
  CONSTRAINT "shipments_pkey" PRIMARY KEY (id),
  CONSTRAINT "shipments_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."shipments"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."shipments"
  ADD COLUMN "status" public.order_status_enum NOT NULL DEFAULT 'paid'::public.order_status_enum;

ALTER TABLE "public"."shipments"
  ADD COLUMN "origin_address" jsonb;

ALTER TABLE "public"."shipments"
  ADD COLUMN "tracking_number" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_url" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "carrier" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "envia_shipment_id" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "shipped_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD COLUMN "delivered_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD COLUMN "completed_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD COLUMN "last_tracked_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD COLUMN "return_tracking_number" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "return_label_url" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "created_at" timestamp WITH time zone DEFAULT now();

ALTER TABLE "public"."shipments"
  ADD COLUMN "updated_at" timestamp WITH time zone DEFAULT now();

ALTER TABLE "public"."shipments"
  ADD COLUMN "stripe_payment_intent_id" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "stripe_payout_id" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "shipping_evidence" jsonb;

ALTER TABLE "public"."shipments"
  ADD COLUMN "shipping_cost" integer DEFAULT 0;

ALTER TABLE "public"."shipments"
  ADD COLUMN "stripe_transfer_id" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_generation_state" text NOT NULL DEFAULT 'unclaimed'::text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "claim_token" uuid;

ALTER TABLE "public"."shipments"
  ADD COLUMN "claim_expires_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD COLUMN "service" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "print_format" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "print_size" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_provider_cost_cents" bigint;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_generated_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_quote_carrier" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_quote_service" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_quote_cost_cents" bigint;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_quote_reference" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_quote_rated_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD COLUMN "label_quote_input_hash" text;

ALTER TABLE "public"."shipments"
  ADD COLUMN "origin_address_id" uuid;

ALTER TABLE "public"."shipments"
  ADD COLUMN "buyer_confirmed_at" timestamp WITH time zone;

ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_label_claim_check" CHECK (((label_generation_state = ANY (ARRAY['claimed'::text, 'generation_sent'::text, 'orphan_pending'::text])) = (claim_token IS
    NOT NULL)));

ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_label_generation_state_check"
    CHECK
    ((label_generation_state = ANY (ARRAY['unclaimed'::text, 'claimed'::text, 'generation_sent'::text, 'retryable_rejected'::text, 'orphan_pending'::text, 'generated'::text])));

ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_label_provider_cost_cents_check" CHECK (((label_provider_cost_cents IS NULL) OR (label_provider_cost_cents >= 0)));

ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_label_quote_cost_cents_check" CHECK (((label_quote_cost_cents IS NULL) OR (label_quote_cost_cents >= 0)));

ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_origin_address_id_fkey" FOREIGN KEY (origin_address_id) REFERENCES public.addresses(id);

CREATE INDEX idx_shipments_auto_completion_due ON public.shipments USING btree (delivered_at)
  WHERE ((status = 'delivered'::public.order_status_enum) AND (buyer_confirmed_at IS NULL) AND (delivered_at IS NOT NULL));

CREATE INDEX idx_shipments_order_id ON public.shipments USING btree (order_id);

CREATE INDEX idx_shipments_seller_id ON public.shipments USING btree (seller_id);

CREATE INDEX idx_shipments_stripe_payment_intent_id ON public.shipments USING btree (stripe_payment_intent_id)
  WHERE (stripe_payment_intent_id IS NOT NULL);

CREATE INDEX idx_shipments_stripe_transfer_id ON public.shipments USING btree (stripe_transfer_id)
  WHERE (stripe_transfer_id IS NOT NULL);

CREATE INDEX shipments_label_generation_state_idx ON public.shipments USING btree (label_generation_state)
  WHERE (label_generation_state = ANY (ARRAY['claimed'::text, 'orphan_pending'::text]));

CREATE TRIGGER shipments_origin_snapshot_immutable
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_shipment_origin_snapshot_mutation();

CREATE TRIGGER trg_shipments_status
  AFTER INSERT OR UPDATE OF status ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shipments_status_trigger();

CREATE POLICY "shipments_delete_block" ON "public"."shipments"
  FOR DELETE
  TO PUBLIC
  USING (false);

CREATE POLICY "shipments_insert_block" ON "public"."shipments"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (false);

CREATE POLICY "shipments_select_participant_or_admin" ON "public"."shipments"
  FOR SELECT
  TO "authenticated"
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = shipments.order_id) AND (o.buyer_id = ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() AS is_admin)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipments" TO "service_role";

COMMENT ON COLUMN "public"."shipments"."stripe_payment_intent_id" IS 'Stripe PaymentIntent ID for this shipment (Connect-era). NULL for legacy wallet-era shipments.';

COMMENT ON COLUMN "public"."shipments"."stripe_payout_id" IS 'Stripe Payout ID when the seller''s Connect balance was transferred to their bank. NULL until release-connect-payout processes the completed shipment.';

COMMENT ON COLUMN "public"."shipments"."stripe_transfer_id" IS 'Stripe Transfer ID created by manual admin release moving platform funds to the seller Connect account, grouped under orders.stripe_transfer_group. NULL until release creates it; written exactly once.';

REVOKE ALL ON TABLE "public"."shipments" FROM "anon";

REVOKE ALL ON TABLE "public"."shipments" FROM "authenticated";

GRANT SELECT ON TABLE "public"."shipments" TO "authenticated";

REVOKE ALL ON TABLE "public"."shipments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipments" TO "postgres";
