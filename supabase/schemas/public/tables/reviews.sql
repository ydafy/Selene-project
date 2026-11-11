CREATE TABLE "public"."reviews" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "reviewer_id" uuid                     NOT NULL,
  "seller_id"   uuid                     NOT NULL,
  "product_id"  uuid,
  "rating"      integer                  NOT NULL,
  "comment"     text,
  "order_id"    uuid,
  "shipment_id" uuid,
  CONSTRAINT "no_self_rating" CHECK ((reviewer_id <> seller_id)),
  CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE,
  CONSTRAINT "reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL,
  CONSTRAINT "reviews_rating_check" CHECK (((rating >= 1) AND (rating <= 5))),
  CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT "reviews_reviewer_id_product_id_key" UNIQUE (reviewer_id, product_id),
  CONSTRAINT "reviews_reviewer_shipment_product_unique" UNIQUE NULLS NOT DISTINCT (reviewer_id, shipment_id, product_id),
  CONSTRAINT "reviews_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT "reviews_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_reviews_shipment_id ON public.reviews USING btree (shipment_id);

CREATE INDEX ix_reviews_product_id ON public.reviews USING btree (product_id);

CREATE INDEX ix_reviews_seller_id ON public.reviews USING btree (seller_id);

CREATE TRIGGER tr_after_review_change
  AFTER INSERT OR DELETE OR UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trigger_review_changes();

CREATE POLICY "reviews_insert" ON "public"."reviews"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((( SELECT auth.uid() AS uid) = reviewer_id) AND (EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE
    ((s.order_id = reviews.order_id) AND (s.seller_id = reviews.seller_id) AND (s.status = 'completed'::public.order_status_enum) AND (o.buyer_id = ( SELECT auth.uid() AS uid)) AND
    (s.id = reviews.shipment_id) AND ((reviews.product_id IS NULL) OR (EXISTS ( SELECT 1
           FROM public.order_items oi
          WHERE ((oi.shipment_id = s.id) AND (oi.product_id = reviews.product_id))))))))));

CREATE POLICY "reviews_select" ON "public"."reviews"
  FOR SELECT
  TO PUBLIC
  USING (true);

REVOKE ALL ON TABLE "public"."reviews" FROM "anon", "authenticated";

GRANT SELECT ON TABLE "public"."reviews" TO "anon";

GRANT INSERT, SELECT ON TABLE "public"."reviews" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reviews" TO "service_role";

REVOKE ALL ON TABLE "public"."reviews" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reviews" TO "postgres";
