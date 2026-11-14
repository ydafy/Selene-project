CREATE TABLE "public"."disputes" (
  "id"        uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "order_id"  uuid NOT NULL,
  "buyer_id"  uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  CONSTRAINT "disputes_pkey" PRIMARY KEY (id),
  CONSTRAINT "disputes_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT "disputes_buyer_id_fkey" FOREIGN KEY (buyer_id) REFERENCES public.profiles(id),
  CONSTRAINT "disputes_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public.profiles(id)
);

ALTER TABLE "public"."disputes"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."disputes"
  ADD COLUMN "reason" public.dispute_reason NOT NULL;

ALTER TABLE "public"."disputes"
  ADD COLUMN "description" text NOT NULL;

ALTER TABLE "public"."disputes"
  ADD COLUMN "buyer_evidence" jsonb DEFAULT '{"images": [], "video_url": null, "tech_checklist": {}}'::jsonb;

ALTER TABLE "public"."disputes"
  ADD COLUMN "seller_evidence" jsonb DEFAULT '{"images": [], "video_url": null}'::jsonb;

ALTER TABLE "public"."disputes"
  ADD COLUMN "status" public.dispute_status DEFAULT 'open'::public.dispute_status;

ALTER TABLE "public"."disputes"
  ADD COLUMN "admin_notes" text;

ALTER TABLE "public"."disputes"
  ADD COLUMN "resolution_type" text;

ALTER TABLE "public"."disputes"
  ADD COLUMN "created_at" timestamp WITH time zone DEFAULT timezone('utc'::text, now());

ALTER TABLE "public"."disputes"
  ADD COLUMN "updated_at" timestamp WITH time zone DEFAULT timezone('utc'::text, now());

ALTER TABLE "public"."disputes"
  ADD COLUMN "locked_by" uuid;

ALTER TABLE "public"."disputes"
  ADD COLUMN "locked_at" timestamp WITH time zone;

ALTER TABLE "public"."disputes"
  ADD COLUMN "resolved_by" uuid;

ALTER TABLE "public"."disputes"
  ADD COLUMN "return_label_url" text;

ALTER TABLE "public"."disputes"
  ADD COLUMN "return_tracking_number" text;

ALTER TABLE "public"."disputes"
  ADD COLUMN "return_delivered_at" timestamp WITH time zone;

ALTER TABLE "public"."disputes"
  ADD COLUMN "return_payout_id" text;

ALTER TABLE "public"."disputes"
  ADD COLUMN "return_payout_status" text DEFAULT 'pending'::text;

ALTER TABLE "public"."disputes"
  ADD COLUMN "return_last_tracked_at" timestamp WITH time zone;

ALTER TABLE "public"."disputes"
  ADD COLUMN "shipment_id" uuid;

ALTER TABLE "public"."disputes"
  ADD CONSTRAINT "disputes_shipment_id_key" UNIQUE (shipment_id);

ALTER TABLE "public"."disputes"
  ADD CONSTRAINT "disputes_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."disputes"
  ADD CONSTRAINT "disputes_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."disputes"
  ADD CONSTRAINT "disputes_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT;

CREATE INDEX idx_disputes_created_at ON public.disputes USING btree (created_at DESC);

CREATE INDEX idx_disputes_locked_by ON public.disputes USING btree (locked_by);

CREATE INDEX idx_disputes_order_id ON public.disputes USING btree (order_id);

CREATE INDEX idx_disputes_return_last_tracked ON public.disputes USING btree (return_last_tracked_at);

CREATE INDEX idx_disputes_status ON public.disputes USING btree (status);

CREATE INDEX ix_disputes_buyer_id ON public.disputes USING btree (buyer_id);

CREATE INDEX ix_disputes_resolved_by ON public.disputes USING btree (resolved_by);

CREATE INDEX ix_disputes_seller_id ON public.disputes USING btree (seller_id);

CREATE TRIGGER notify_dispute_opened
  AFTER INSERT ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_dispute_opened();

CREATE TRIGGER set_product_in_dispute
  AFTER INSERT ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_product_in_dispute();

CREATE TRIGGER tr_on_dispute_opened
  AFTER INSERT ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_on_dispute_opened();

CREATE POLICY "disputes_select" ON "public"."disputes"
  FOR SELECT
  TO PUBLIC
  USING (((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id) OR ( SELECT public.is_admin() AS is_admin)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."disputes" TO "service_role";

REVOKE ALL ON TABLE "public"."disputes" FROM "anon";

REVOKE ALL ON TABLE "public"."disputes" FROM "authenticated";

GRANT SELECT ON TABLE "public"."disputes" TO "authenticated";

REVOKE ALL ON TABLE "public"."disputes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."disputes" TO "postgres";
